export type PublicationMemoryItem = {
  id: string;
  source_knowledge_item_id: string;
  knowledge_lineage_id: string | null;
  knowledge_type: string;
  title: string;
  content: string;
  citation_sources: unknown;
};

export type MemoryEvidenceItem = PublicationMemoryItem & {
  ref: string;
  period: 'previous' | 'current';
};

export type MemoryMatchBasis = 'same_lineage' | 'strong_semantic';

export type MemoryCandidatePair = {
  beforeRef: string;
  afterRef: string;
  basis: MemoryMatchBasis;
};

export type MemoryMatchingPlan = {
  pairs: MemoryCandidatePair[];
  addedRefs: string[];
  retiredRefs: string[];
  omittedRefs: string[];
};

export type ValidatedMemoryChange = {
  changeType: 'added' | 'changed' | 'retired';
  before: MemoryEvidenceItem | null;
  after: MemoryEvidenceItem | null;
  title: string;
  summary: string;
  matchBasis: MemoryMatchBasis | 'not_applicable';
  reasonStatement: string | null;
  reasonEvidence: MemoryEvidenceItem | null;
};

export const MAX_REASON_STATEMENT_CHARS = 300;

export function isMemoryScope(
  row: { organization_id: string; role_id: string },
  scope: { organizationId: string; roleId: string },
) {
  return row.organization_id === scope.organizationId && row.role_id === scope.roleId;
}

export const organizationMemorySchema = {
  type: 'object',
  properties: {
    changes: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        properties: {
          change_type: { type: 'string', enum: ['added', 'changed', 'retired'] },
          previous_ref: { type: ['string', 'null'] },
          current_ref: { type: ['string', 'null'] },
          reason_statement: {
            type: ['string', 'null'],
            description: 'A concise reason only when an approved published item explicitly states the cause. Null otherwise.',
          },
          reason_evidence_ref: {
            type: ['string', 'null'],
            description: 'The approved published item that explicitly states the cause. Null when reason_statement is null.',
          },
        },
        required: [
          'change_type', 'previous_ref', 'current_ref', 'reason_statement', 'reason_evidence_ref',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['changes'],
  additionalProperties: false,
};

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'by', 'do', 'does', 'for', 'from',
  'has', 'have', 'in', 'is', 'it', 'its', 'must', 'of', 'on', 'or', 'should', 'that', 'the', 'their',
  'this', 'to', 'was', 'were', 'will', 'with', 'you', 'your',
]);

const SEMANTIC_STOP_WORDS = new Set([
  ...STOP_WORDS,
  'about', 'after', 'again', 'before', 'change', 'changed', 'contact', 'deadline', 'during', 'each',
  'handoff', 'into', 'lesson', 'process', 'resource', 'responsibility', 'role', 'there', 'these',
  'those', 'through', 'warning', 'what', 'when', 'where', 'which', 'would',
]);

const TOKEN_EQUIVALENTS: Record<string, string> = {
  booked: 'book',
  booking: 'book',
  bookings: 'book',
  requires: 'require',
  required: 'require',
  requiring: 'require',
  submission: 'submit',
  submissions: 'submit',
  submitted: 'submit',
  submitting: 'submit',
  sends: 'send',
  sending: 'send',
  sent: 'send',
  payments: 'payment',
  forms: 'form',
  reports: 'report',
};

export function broadMemoryKnowledgeType(type: string) {
  if (type === 'responsibility') return 'process';
  if (type === 'deadline') return 'rule_deadline';
  if (type === 'warning' || type === 'lesson') return 'warning_lesson';
  if (type === 'resource') return 'access_resource';
  return type;
}

function words(text: string, stopWords: Set<string>) {
  return text.normalize('NFKD').toLocaleLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => TOKEN_EQUIVALENTS[token] ?? token)
    .filter((token) => !stopWords.has(token));
}

function materialFingerprint(text: string) {
  return words(text, STOP_WORDS).sort().join(' ');
}

/**
 * A deliberately narrow, deterministic noise filter. Broader paraphrases are
 * left to the conservative materiality review, but punctuation, formatting,
 * word order, and common grammatical rewrites never become changes.
 */
export function isClearlyEquivalentMemoryContent(
  before: Pick<PublicationMemoryItem, 'content'>,
  after: Pick<PublicationMemoryItem, 'content'>,
) {
  return materialFingerprint(before.content) === materialFingerprint(after.content);
}

function semanticTokens(item: Pick<PublicationMemoryItem, 'title' | 'content'>) {
  return new Set(words(`${item.title} ${item.content}`, SEMANTIC_STOP_WORDS)
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token)));
}

function jaccard(left: Set<string>, right: Set<string>) {
  const union = new Set([...left, ...right]);
  if (!union.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / union.size;
}

function legacySemanticScore(before: MemoryEvidenceItem, after: MemoryEvidenceItem) {
  if (broadMemoryKnowledgeType(before.knowledge_type) !== broadMemoryKnowledgeType(after.knowledge_type)) return 0;
  const beforeAll = semanticTokens(before);
  const afterAll = semanticTokens(after);
  const shared = [...beforeAll].filter((token) => afterAll.has(token));
  if (shared.length < 2 && !shared.some((token) => token.length >= 8)) return 0;
  const beforeTitle = new Set(words(before.title, SEMANTIC_STOP_WORDS));
  const afterTitle = new Set(words(after.title, SEMANTIC_STOP_WORDS));
  return (jaccard(beforeAll, afterAll) * 0.65) + (jaccard(beforeTitle, afterTitle) * 0.35);
}

function groupByLineage(items: MemoryEvidenceItem[]) {
  const grouped = new Map<string, MemoryEvidenceItem[]>();
  for (const item of items) {
    if (!item.knowledge_lineage_id) continue;
    const group = grouped.get(item.knowledge_lineage_id) ?? [];
    group.push(item);
    grouped.set(item.knowledge_lineage_id, group);
  }
  return grouped;
}

/**
 * Existing carry-forward lineage is the normal matcher. The lexical semantic
 * matcher runs only for legacy rows where both publications lack lineage, and
 * accepts only an unambiguous mutual-best pair. Ambiguous legacy candidates
 * are omitted instead of being mislabeled Added/Retired.
 */
export function createMemoryMatchingPlan(evidence: MemoryEvidenceItem[]): MemoryMatchingPlan {
  const previous = evidence.filter((item) => item.period === 'previous');
  const current = evidence.filter((item) => item.period === 'current');
  const previousByLineage = groupByLineage(previous);
  const currentByLineage = groupByLineage(current);
  const pairs: MemoryCandidatePair[] = [];
  const addedRefs: string[] = [];
  const retiredRefs: string[] = [];
  const omittedRefs = new Set<string>();

  const lineages = new Set([...previousByLineage.keys(), ...currentByLineage.keys()]);
  for (const lineage of lineages) {
    const before = previousByLineage.get(lineage) ?? [];
    const after = currentByLineage.get(lineage) ?? [];
    if (before.length === 1 && after.length === 1) {
      if (!isClearlyEquivalentMemoryContent(before[0], after[0])) {
        pairs.push({ beforeRef: before[0].ref, afterRef: after[0].ref, basis: 'same_lineage' });
      } else {
        omittedRefs.add(before[0].ref);
        omittedRefs.add(after[0].ref);
      }
    } else if (before.length === 0 && after.length === 1) {
      addedRefs.push(after[0].ref);
    } else if (before.length === 1 && after.length === 0) {
      retiredRefs.push(before[0].ref);
    } else {
      before.forEach((item) => omittedRefs.add(item.ref));
      after.forEach((item) => omittedRefs.add(item.ref));
    }
  }

  const legacyPrevious = previous.filter((item) => !item.knowledge_lineage_id);
  const legacyCurrent = current.filter((item) => !item.knowledge_lineage_id);
  const scores = new Map<string, number>();
  for (const before of legacyPrevious) {
    for (const after of legacyCurrent) {
      scores.set(`${before.ref}:${after.ref}`, legacySemanticScore(before, after));
    }
  }
  const rankedAfter = new Map<string, { ref: string; score: number }[]>();
  const rankedBefore = new Map<string, { ref: string; score: number }[]>();
  for (const before of legacyPrevious) {
    rankedAfter.set(before.ref, legacyCurrent
      .map((after) => ({ ref: after.ref, score: scores.get(`${before.ref}:${after.ref}`) ?? 0 }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score));
  }
  for (const after of legacyCurrent) {
    rankedBefore.set(after.ref, legacyPrevious
      .map((before) => ({ ref: before.ref, score: scores.get(`${before.ref}:${after.ref}`) ?? 0 }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score));
  }

  const pairedPrevious = new Set<string>();
  const pairedCurrent = new Set<string>();
  for (const before of legacyPrevious) {
    const choices = rankedAfter.get(before.ref) ?? [];
    const best = choices[0];
    if (!best || best.score < 0.42 || (choices[1] && best.score - choices[1].score < 0.12)) continue;
    const reverse = rankedBefore.get(best.ref) ?? [];
    if (reverse[0]?.ref !== before.ref
      || (reverse[1] && reverse[0].score - reverse[1].score < 0.12)) continue;
    const after = legacyCurrent.find((item) => item.ref === best.ref)!;
    pairedPrevious.add(before.ref);
    pairedCurrent.add(after.ref);
    if (!isClearlyEquivalentMemoryContent(before, after)) {
      pairs.push({ beforeRef: before.ref, afterRef: after.ref, basis: 'strong_semantic' });
    } else {
      omittedRefs.add(before.ref);
      omittedRefs.add(after.ref);
    }
  }

  for (const before of legacyPrevious) {
    if (pairedPrevious.has(before.ref)) continue;
    omittedRefs.add(before.ref);
  }
  for (const after of legacyCurrent) {
    if (pairedCurrent.has(after.ref)) continue;
    omittedRefs.add(after.ref);
  }

  return { pairs, addedRefs, retiredRefs, omittedRefs: [...omittedRefs] };
}

export function memoryCandidatePrompt(plan: MemoryMatchingPlan) {
  return [
    ...plan.pairs.map((pair) => (
      `CHANGED_CANDIDATE ${pair.beforeRef} -> ${pair.afterRef} (${pair.basis === 'same_lineage' ? 'preserved lineage' : 'legacy fallback: lineage missing'})`
    )),
    ...plan.addedRefs.map((ref) => `ADDED_CANDIDATE ${ref}`),
    ...plan.retiredRefs.map((ref) => `RETIRED_CANDIDATE ${ref}`),
  ].join('\n');
}

const EXPLICIT_CAUSE_PATTERN = /\b(because|due to|as a result of|in response to|prompted by|caused by|to comply with|required by|mandated by)\b/i;

export function groundedMemoryReason(
  statement: unknown,
  evidenceRef: unknown,
  evidenceByRef: Map<string, MemoryEvidenceItem>,
  changeEvidence: MemoryEvidenceItem[] = [],
) {
  if (statement === null && evidenceRef === null) return { statement: null, evidence: null };
  if (typeof statement !== 'string' || typeof evidenceRef !== 'string') return { statement: null, evidence: null };
  const trimmed = statement.trim();
  const evidence = evidenceByRef.get(evidenceRef) ?? null;
  if (!trimmed || trimmed.length > MAX_REASON_STATEMENT_CHARS || !evidence) return { statement: null, evidence: null };
  const evidenceText = `${evidence.title} ${evidence.content}`;
  if (!EXPLICIT_CAUSE_PATTERN.test(evidenceText)) return { statement: null, evidence: null };
  const reasonTokens = new Set(words(trimmed, SEMANTIC_STOP_WORDS).filter((token) => token.length >= 3));
  const evidenceTokens = semanticTokens(evidence);
  const shared = [...reasonTokens].filter((token) => evidenceTokens.has(token));
  if (shared.length < Math.min(2, reasonTokens.size)) return { statement: null, evidence: null };
  if (changeEvidence.length && !changeEvidence.some((item) => item.id === evidence.id)) {
    const changedTokens = new Set(changeEvidence.flatMap((item) => [...semanticTokens(item)]));
    const changeOverlap = [...evidenceTokens].filter((token) => changedTokens.has(token));
    if (changeOverlap.length < 2) return { statement: null, evidence: null };
  }
  return { statement: trimmed, evidence };
}

export function validateMemoryChanges(
  value: unknown,
  evidenceByRef: Map<string, MemoryEvidenceItem>,
  plan: MemoryMatchingPlan,
): ValidatedMemoryChange[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid handoff comparison.');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Array.isArray(record.changes) || record.changes.length > 100) {
    throw new Error('Invalid handoff comparison.');
  }
  const pairByRefs = new Map(plan.pairs.map((pair) => [`${pair.beforeRef}:${pair.afterRef}`, pair]));
  const allowedAdded = new Set(plan.addedRefs);
  const allowedRetired = new Set(plan.retiredRefs);
  const usedPrevious = new Set<string>();
  const usedCurrent = new Set<string>();

  return record.changes.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid material change.');
    const change = raw as Record<string, unknown>;
    const expected = [
      'change_type', 'current_ref', 'previous_ref', 'reason_evidence_ref',
      'reason_statement',
    ];
    const keys = Object.keys(change).sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])
      || !['added', 'changed', 'retired'].includes(String(change.change_type))) {
      throw new Error('Invalid material change.');
    }
    const before = typeof change.previous_ref === 'string' ? evidenceByRef.get(change.previous_ref) ?? null : null;
    const after = typeof change.current_ref === 'string' ? evidenceByRef.get(change.current_ref) ?? null : null;
    let matchBasis: ValidatedMemoryChange['matchBasis'] = 'not_applicable';
    if (change.change_type === 'changed') {
      if (!before || !after) throw new Error('Changed knowledge needs both snapshots.');
      const pair = pairByRefs.get(`${before.ref}:${after.ref}`);
      if (!pair) throw new Error('Changed knowledge is outside the verified matching plan.');
      matchBasis = pair.basis;
    } else if (change.change_type === 'added') {
      if (before || !after || !allowedAdded.has(after.ref)) throw new Error('Added knowledge is outside the verified matching plan.');
    } else if (!before || after || !allowedRetired.has(before.ref)) {
      throw new Error('Retired knowledge is outside the verified matching plan.');
    }
    if (before && usedPrevious.has(before.ref)) throw new Error('Prior knowledge was duplicated.');
    if (after && usedCurrent.has(after.ref)) throw new Error('Current knowledge was duplicated.');
    if (before) usedPrevious.add(before.ref);
    if (after) usedCurrent.add(after.ref);
    const reason = groundedMemoryReason(
      change.reason_statement,
      change.reason_evidence_ref,
      evidenceByRef,
      [before, after].filter((item): item is MemoryEvidenceItem => Boolean(item)),
    );
    const authoritativeTitle = (after ?? before)!.title;
    const summary = change.change_type === 'changed'
      ? 'Material content changed between the published handoffs.'
      : change.change_type === 'added'
        ? 'This approved knowledge was added in the current published handoff.'
        : 'This approved knowledge is no longer current in the latest published handoff.';
    return {
      changeType: change.change_type as ValidatedMemoryChange['changeType'],
      before,
      after,
      title: authoritativeTitle,
      summary,
      matchBasis,
      reasonStatement: reason.statement,
      reasonEvidence: reason.evidence,
    };
  });
}
