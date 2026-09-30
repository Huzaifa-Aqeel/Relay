export type PublicationMemoryItem = {
  id: string;
  source_knowledge_item_id: string;
  knowledge_lineage_id: string | null;
  knowledge_type: string;
  title: string;
  content: string;
  comparison_value?: string;
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
  omittedRefs: string[];
};

const MONTH_PATTERN = /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i;
const EXPLICIT_TEMPORAL_CHANGE_PATTERN = /\b(?:because|due to|changed from|moved from|moved to|increased|decreased|shortened|extended|new requirement|now required|no longer)\b/i;
const TEMPORAL_TOPIC_PATTERN = /\b(?:date|deadline|schedule|scheduled|milestone|rehearsal|submit|submission|confirm|confirmation|due)\b/i;
const GENERIC_RESOURCE_SCOPE_PATTERN = /\b(?:scope|use\s+.+\s+(?:procedure|guide|manual)\s+to\s+(?:control|govern|cover)|(?:procedure|guide|manual)\s+(?:controls|governs|covers))\b/i;

export type MemoryEvaluationCandidate = {
  id: string;
  type: 'changed' | 'added';
  beforeRef: string | null;
  afterRef: string | null;
  basis: MemoryMatchBasis | 'not_applicable';
};

export type ValidatedMemoryChange = {
  changeType: 'added' | 'changed' | 'retired' | 'resolved';
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
    results: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        properties: {
          candidate_id: { type: 'string', pattern: '^K[1-9][0-9]*$' },
          include: { type: 'boolean' },
          change_type: {
            type: ['string', 'null'],
            enum: ['added', 'changed', 'retired', 'resolved', null],
          },
          reason_statement: {
            type: ['string', 'null'],
            description: 'A concise reason only when an approved published item explicitly states the cause. Null otherwise.',
          },
          reason_support_ref: {
            type: ['string', 'null'],
            description: 'The previous or current item in this exact candidate that explicitly states the cause. Null when reason_statement is null.',
          },
        },
        required: [
          'candidate_id', 'include', 'change_type', 'reason_statement', 'reason_support_ref',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
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
  examinations: 'examination',
  policies: 'policy',
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

function explicitModality(text: string) {
  const normalized = text.toLocaleLowerCase();
  const modality = new Set<string>();
  if (/\b(must not|shall not|prohibited|forbidden|do not)\b/.test(normalized)) modality.add('prohibited');
  if (/\b(must|required|requires|shall|mandatory)\b/.test(normalized)) modality.add('mandatory');
  if (/\b(should|recommended|recommendation|advised)\b/.test(normalized)) modality.add('advisory');
  if (/\b(may|optional|permitted|allowed)\b/.test(normalized)) modality.add('optional');
  return [...modality].sort().join(':');
}

/**
 * A deliberately narrow, deterministic noise filter. Broader paraphrases are
 * left to the conservative materiality review, but punctuation, formatting,
 * word order, and common grammatical rewrites never become changes.
 */
export function isClearlyEquivalentMemoryContent(
  before: Pick<PublicationMemoryItem, 'content' | 'comparison_value'>,
  after: Pick<PublicationMemoryItem, 'content' | 'comparison_value'>,
) {
  const beforeValue = before.comparison_value?.trim() || before.content;
  const afterValue = after.comparison_value?.trim() || after.content;
  const beforeModality = explicitModality(beforeValue);
  const afterModality = explicitModality(afterValue);
  if (beforeModality && afterModality && beforeModality !== afterModality) return false;
  return materialFingerprint(beforeValue) === materialFingerprint(afterValue);
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
 * Existing publication lineage is the normal matcher. The lexical semantic
 * matcher runs only for legacy rows where both publications lack lineage, and
 * accepts only an unambiguous mutual-best pair. When legacy continuity cannot
 * be established, the prior fact is omitted and any unmatched current fact
 * remains eligible as Added.
 */
export function createMemoryMatchingPlan(evidence: MemoryEvidenceItem[]): MemoryMatchingPlan {
  const previous = evidence.filter((item) => item.period === 'previous');
  const current = evidence.filter((item) => item.period === 'current');
  const previousByLineage = groupByLineage(previous);
  const currentByLineage = groupByLineage(current);
  const pairs: MemoryCandidatePair[] = [];
  const addedRefs: string[] = [];
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
      omittedRefs.add(before[0].ref);
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
    addedRefs.push(after.ref);
  }

  return { pairs, addedRefs, omittedRefs: [...omittedRefs] };
}

/**
 * A corresponding-year calendar instance is not itself an institutional
 * change. When both claims merely move the same recurring task into the next
 * service year, omit the pair unless approved wording explicitly says the
 * schedule or requirement changed.
 */
export function isRoutineAnnualInstanceChange(
  before: MemoryEvidenceItem,
  after: MemoryEvidenceItem,
) {
  const beforeText = `${before.title} ${before.content} ${before.comparison_value ?? ''}`;
  const afterText = `${after.title} ${after.content} ${after.comparison_value ?? ''}`;
  if (EXPLICIT_TEMPORAL_CHANGE_PATTERN.test(afterText)) return false;
  if (!TEMPORAL_TOPIC_PATTERN.test(`${before.title} ${after.title}`)
    && (!MONTH_PATTERN.test(beforeText) || !MONTH_PATTERN.test(afterText))) return false;
  const beforeYears = [...beforeText.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
  const afterYears = [...afterText.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
  if (!beforeYears.length || !afterYears.length) return false;
  return beforeYears.some((year) => afterYears.includes(year + 1));
}

export function isGenericResourceScopeChange(
  before: MemoryEvidenceItem,
  after: MemoryEvidenceItem,
) {
  if (broadMemoryKnowledgeType(before.knowledge_type) !== 'access_resource'
    && broadMemoryKnowledgeType(after.knowledge_type) !== 'access_resource') return false;
  return GENERIC_RESOURCE_SCOPE_PATTERN.test(`${before.title} ${before.content}`)
    || GENERIC_RESOURCE_SCOPE_PATTERN.test(`${after.title} ${after.content}`);
}

export function materialMemoryPairPlan(
  plan: MemoryMatchingPlan,
  evidenceByRef: Map<string, MemoryEvidenceItem>,
): MemoryMatchingPlan {
  const pairs = plan.pairs.filter((pair) => {
    const before = evidenceByRef.get(pair.beforeRef);
    const after = evidenceByRef.get(pair.afterRef);
    if (!before || !after) return false;
    return !isRoutineAnnualInstanceChange(before, after)
      && !isGenericResourceScopeChange(before, after);
  });
  return {
    pairs,
    addedRefs: [],
    omittedRefs: plan.omittedRefs,
  };
}

export function memoryCandidates(plan: MemoryMatchingPlan): MemoryEvaluationCandidate[] {
  return [
    ...plan.pairs.map((pair) => ({
      type: 'changed' as const,
      beforeRef: pair.beforeRef,
      afterRef: pair.afterRef,
      basis: pair.basis,
    })),
    ...plan.addedRefs.map((ref) => ({
      type: 'added' as const,
      beforeRef: null,
      afterRef: ref,
      basis: 'not_applicable' as const,
    })),
  ].slice(0, 100).map((candidate, index) => ({ ...candidate, id: `K${index + 1}` }));
}

export function memoryCandidatePrompt(plan: MemoryMatchingPlan) {
  return memoryCandidates(plan).map((candidate) => {
    if (candidate.type === 'changed') {
      return [
        `[${candidate.id}]`,
        'Type: CHANGED_CANDIDATE',
        `Previous: ${candidate.beforeRef}`,
        `Current: ${candidate.afterRef}`,
        `Relationship basis: ${candidate.basis === 'same_lineage' ? 'preserved lineage' : 'legacy fallback: lineage missing'}`,
      ].join('\n');
    }
    if (candidate.type === 'added') {
      return `[${candidate.id}]\nType: ADDED_CANDIDATE\nCurrent: ${candidate.afterRef}`;
    }
  }).join('\n\n');
}

const EXPLICIT_RETIREMENT_PATTERN = /\b(no longer (?:used|accepted|available|applicable|required)|discontinued|retired|replaced (?:by|with)|superseded|obsolete|do not use)\b/i;
const EXPLICIT_PENDING_PATTERN = /\b(pending|outstanding|awaiting|unresolved|not yet|(?:has|had) not been|remains? to be|still needs?)\b/i;
const EXPLICIT_RESOLUTION_PATTERN = /\b(resolved|completed|closed|settled|finalized|has been approved|was approved|has been confirmed|was confirmed)\b/i;

function evidenceBacksRetirement(after: MemoryEvidenceItem | null) {
  return Boolean(after && EXPLICIT_RETIREMENT_PATTERN.test(`${after.title} ${after.content}`));
}

function evidenceBacksResolution(before: MemoryEvidenceItem | null, after: MemoryEvidenceItem | null) {
  return Boolean(
    before
    && after
    && EXPLICIT_PENDING_PATTERN.test(`${before.title} ${before.content}`)
    && EXPLICIT_RESOLUTION_PATTERN.test(`${after.title} ${after.content}`),
  );
}

const EXPLICIT_CAUSE_PATTERN = /\b(because|due to|as a result of|in response to|prompted by|caused by|to comply with|required by|mandated by)\b/i;

function explicitCausalPassage(text: string) {
  const sentences = text.split(/(?<=[.!?])\s+|[\r\n]+/).map((sentence) => sentence.trim()).filter(Boolean);
  for (const sentence of sentences) {
    const match = EXPLICIT_CAUSE_PATTERN.exec(sentence);
    if (!match || match.index === undefined) continue;
    const passage = sentence.slice(match.index).trim();
    if (!passage) continue;
    return passage[0].toLocaleUpperCase() + passage.slice(1);
  }
  return null;
}

function safeEvidenceReason(passage: string | null) {
  if (!passage) return null;
  const normalized = passage.replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > MAX_REASON_STATEMENT_CHARS) return null;
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

export function explicitMemoryReason(item: MemoryEvidenceItem | null) {
  if (!item) return { statement: null, evidence: null };
  const passage = explicitCausalPassage(item.content) ?? explicitCausalPassage(item.title);
  const statement = safeEvidenceReason(passage);
  return statement ? { statement, evidence: item } : { statement: null, evidence: null };
}

function memorySummary(changeType: ValidatedMemoryChange['changeType']) {
  return changeType === 'changed'
    ? 'Material content changed between the published handoffs.'
    : changeType === 'added'
      ? 'This approved knowledge was added in the current published handoff.'
      : changeType === 'retired'
        ? 'Approved current evidence explicitly says this knowledge was retired or replaced.'
        : 'Approved current evidence explicitly says this outstanding obligation was resolved.';
}

/**
 * Atomic claim indexes already establish identity and material value. Normal
 * comparison therefore needs no second model call: it compares topic lineage,
 * hides equivalent values, and uses only explicit published wording for the
 * exceptional Resolved, Retired, and reason fields.
 */
export function deterministicMemoryChanges(
  evidenceByRef: Map<string, MemoryEvidenceItem>,
  plan: MemoryMatchingPlan,
): ValidatedMemoryChange[] {
  const changes: ValidatedMemoryChange[] = [];
  for (const candidate of memoryCandidates(plan)) {
    const before = candidate.beforeRef ? evidenceByRef.get(candidate.beforeRef) ?? null : null;
    const after = candidate.afterRef ? evidenceByRef.get(candidate.afterRef) ?? null : null;
    if ((candidate.beforeRef && !before) || (candidate.afterRef && !after)) continue;

    let changeType: ValidatedMemoryChange['changeType'];
    if (candidate.type === 'added') changeType = 'added';
    else if (evidenceBacksResolution(before, after)) changeType = 'resolved';
    else if (evidenceBacksRetirement(after)) changeType = 'retired';
    else changeType = 'changed';

    const reason = explicitMemoryReason(after).statement
      ? explicitMemoryReason(after)
      : explicitMemoryReason(before);
    changes.push({
      changeType,
      before,
      after,
      title: (after ?? before)!.title,
      summary: memorySummary(changeType),
      matchBasis: candidate.basis,
      reasonStatement: reason.statement,
      reasonEvidence: reason.evidence,
    });
  }
  return changes;
}

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
  if (!trimmed || !evidence) return { statement: null, evidence: null };
  const evidenceText = `${evidence.title} ${evidence.content}`;
  if (!EXPLICIT_CAUSE_PATTERN.test(evidenceText)) return { statement: null, evidence: null };
  const causalPassage = explicitCausalPassage(evidence.content) ?? explicitCausalPassage(evidence.title);
  const evidenceFallback = safeEvidenceReason(causalPassage);
  const reasonTokens = new Set(words(trimmed, SEMANTIC_STOP_WORDS).filter((token) => token.length >= 3));
  const evidenceTokens = semanticTokens(evidence);
  if (changeEvidence.length && !changeEvidence.some((item) => item.id === evidence.id)) {
    const changedTokens = new Set(changeEvidence.flatMap((item) => [...semanticTokens(item)]));
    const changeOverlap = [...evidenceTokens].filter((token) => changedTokens.has(token));
    if (changeOverlap.length < 2) return { statement: null, evidence: null };
  }
  const causalTokens = new Set(words(causalPassage ?? '', SEMANTIC_STOP_WORDS).filter((token) => token.length >= 3));
  const sharedCause = [...reasonTokens].filter((token) => causalTokens.has(token));
  if (trimmed.length <= MAX_REASON_STATEMENT_CHARS && sharedCause.length >= 1) {
    return { statement: trimmed, evidence };
  }
  return evidenceFallback ? { statement: evidenceFallback, evidence } : { statement: null, evidence: null };
}

export function validateMemoryChanges(
  value: unknown,
  evidenceByRef: Map<string, MemoryEvidenceItem>,
  plan: MemoryMatchingPlan,
): ValidatedMemoryChange[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid handoff comparison.');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Array.isArray(record.results) || record.results.length > 100) {
    throw new Error('Invalid handoff comparison.');
  }
  const expectedCandidates = memoryCandidates(plan);
  if (record.results.length !== expectedCandidates.length) throw new Error('Incomplete handoff comparison.');
  const candidateById = new Map(expectedCandidates.map((candidate) => [candidate.id, candidate]));
  const seenCandidates = new Set<string>();
  const results: ValidatedMemoryChange[] = [];

  for (const raw of record.results) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid material-change decision.');
    const decision = raw as Record<string, unknown>;
    const expected = [
      'candidate_id', 'change_type', 'include', 'reason_statement', 'reason_support_ref',
    ];
    const keys = Object.keys(decision).sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
      throw new Error('Invalid material-change decision.');
    }
    if (typeof decision.candidate_id !== 'string' || seenCandidates.has(decision.candidate_id)) {
      throw new Error('Invalid or duplicated candidate decision.');
    }
    const candidate = candidateById.get(decision.candidate_id);
    if (!candidate || typeof decision.include !== 'boolean') {
      throw new Error('Unknown candidate decision.');
    }
    seenCandidates.add(candidate.id);
    if (!decision.include) {
      if (decision.change_type !== null || decision.reason_statement !== null || decision.reason_support_ref !== null) {
        throw new Error('Excluded candidates must not contain a classification or reason.');
      }
      continue;
    }

    const before = candidate.beforeRef ? evidenceByRef.get(candidate.beforeRef) ?? null : null;
    const after = candidate.afterRef ? evidenceByRef.get(candidate.afterRef) ?? null : null;
    if ((candidate.beforeRef && !before) || (candidate.afterRef && !after)) {
      throw new Error('Candidate evidence is unavailable.');
    }

    let changeType: ValidatedMemoryChange['changeType'];
    if (candidate.type === 'changed') {
      if (!['changed', 'retired', 'resolved'].includes(String(decision.change_type))) {
        throw new Error('Changed candidate has an invalid classification.');
      }
      changeType = decision.change_type as 'changed' | 'retired' | 'resolved';
      if (changeType === 'retired' && !evidenceBacksRetirement(after)) changeType = 'changed';
      if (changeType === 'resolved' && !evidenceBacksResolution(before, after)) changeType = 'changed';
    } else {
      if (decision.change_type !== 'added') throw new Error('Added candidate has an invalid classification.');
      changeType = 'added';
    }

    const allowedReasonRefs = new Set([candidate.beforeRef, candidate.afterRef].filter(Boolean));
    if (decision.reason_support_ref !== null
      && (typeof decision.reason_support_ref !== 'string' || !allowedReasonRefs.has(decision.reason_support_ref))) {
      throw new Error('Reason support is outside its candidate.');
    }
    const reason = groundedMemoryReason(
      decision.reason_statement,
      decision.reason_support_ref,
      evidenceByRef,
      [before, after].filter((item): item is MemoryEvidenceItem => Boolean(item)),
    );
    const authoritativeTitle = (after ?? before)!.title;
    const summary = memorySummary(changeType);
    results.push({
      changeType,
      before,
      after,
      title: authoritativeTitle,
      summary,
      matchBasis: candidate.basis,
      reasonStatement: reason.statement,
      reasonEvidence: reason.evidence,
    });
  }
  if (seenCandidates.size !== expectedCandidates.length) throw new Error('Incomplete handoff comparison.');
  return results;
}
