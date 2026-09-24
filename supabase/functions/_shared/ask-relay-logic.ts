export const MAX_EVIDENCE_ITEMS = 24;
export const MAX_EVIDENCE_CHARS = 32_000;
export const UNSUPPORTED_ANSWER = 'This handoff does not contain a reliable answer to that question.';
export const RRF_K = 60;

const GENERIC_QUERY_TERMS = new Set([
  'a', 'about', 'an', 'are', 'can', 'do', 'does', 'for', 'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on',
  'should', 'that', 'the', 'this', 'to', 'what', 'when', 'where', 'who', 'why', 'with',
]);

export type PublicationItem = {
  id: string;
  source_knowledge_item_id: string;
  knowledge_type: string;
  title: string;
  content: string;
  sort_order: number;
  citation_sources: unknown;
};

export type CitationSource = { label: string; locator: string | null };
export type Evidence = PublicationItem & { ref: string; sources: CitationSource[] };
export type Bm25fParameters = {
  k1: number;
  titleWeight: number;
  contentWeight: number;
  titleLengthNormalization: number;
  contentLengthNormalization: number;
};

export const BM25F_PARAMETERS: Readonly<Bm25fParameters> = Object.freeze({
  k1: 1.2,
  titleWeight: 1,
  contentWeight: 1.15,
  titleLengthNormalization: 0.75,
  contentLengthNormalization: 0.75,
});

export function parseCitationSources(value: unknown): CitationSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const source = candidate as Record<string, unknown>;
    if (typeof source.label !== 'string' || !source.label.trim()) return [];
    return [{
      label: source.label.trim().slice(0, 160),
      locator: typeof source.locator === 'string' ? source.locator.trim().slice(0, 200) || null : null,
    }];
  }).slice(0, 8);
}

function words(value: string) {
  return value.toLocaleLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function meaningfulQueryTerms(question: string) {
  return [...new Set(words(question).filter((term) => term.length > 1 && !GENERIC_QUERY_TERMS.has(term)))];
}

function termFrequencies(tokens: string[]) {
  const frequencies = new Map<string, number>();
  for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  return frequencies;
}

function normalizedFieldFrequency(
  frequency: number,
  fieldLength: number,
  averageFieldLength: number,
  lengthNormalization: number,
) {
  if (!frequency) return 0;
  const denominator = (1 - lengthNormalization)
    + lengthNormalization * (fieldLength / Math.max(averageFieldLength, 1));
  return frequency / Math.max(denominator, Number.EPSILON);
}

export function rankPublicationItems(
  question: string,
  items: PublicationItem[],
  parameters: Readonly<Bm25fParameters> = BM25F_PARAMETERS,
) {
  const terms = meaningfulQueryTerms(question);
  const indexedItems = items.map((item) => {
    const titleTokens = words(item.title);
    const contentTokens = words(item.content);
    return {
      item,
      titleLength: titleTokens.length,
      contentLength: contentTokens.length,
      titleFrequencies: termFrequencies(titleTokens),
      contentFrequencies: termFrequencies(contentTokens),
    };
  });
  if (!indexedItems.length) return [];

  const averageTitleLength = indexedItems.reduce((total, entry) => total + entry.titleLength, 0)
    / indexedItems.length;
  const averageContentLength = indexedItems.reduce((total, entry) => total + entry.contentLength, 0)
    / indexedItems.length;
  const documentFrequencies = new Map(terms.map((term) => [
    term,
    indexedItems.filter((entry) => (
      entry.titleFrequencies.has(term) || entry.contentFrequencies.has(term)
    )).length,
  ]));

  return indexedItems.map((entry) => {
    const score = terms.reduce((total, term) => {
      const documentFrequency = documentFrequencies.get(term) ?? 0;
      if (!documentFrequency) return total;
      const inverseDocumentFrequency = Math.log(
        1 + ((indexedItems.length - documentFrequency + 0.5) / (documentFrequency + 0.5)),
      );
      const titleFrequency = normalizedFieldFrequency(
        entry.titleFrequencies.get(term) ?? 0,
        entry.titleLength,
        averageTitleLength,
        parameters.titleLengthNormalization,
      );
      const contentFrequency = normalizedFieldFrequency(
        entry.contentFrequencies.get(term) ?? 0,
        entry.contentLength,
        averageContentLength,
        parameters.contentLengthNormalization,
      );
      const combinedFrequency = parameters.titleWeight * titleFrequency
        + parameters.contentWeight * contentFrequency;
      if (!combinedFrequency) return total;
      const saturatedFrequency = ((parameters.k1 + 1) * combinedFrequency)
        / (parameters.k1 + combinedFrequency);
      return total + inverseDocumentFrequency * saturatedFrequency;
    }, 0);
    return { item: entry.item, score };
  }).sort((left, right) => {
    if (left.score !== right.score) return right.score - left.score;
    return left.item.sort_order - right.item.sort_order;
  });
}

export function rankPublicationItemsHybrid(
  question: string,
  items: PublicationItem[],
  vectorRankedItemIds: string[],
  parameters: Readonly<Bm25fParameters> = BM25F_PARAMETERS,
) {
  const lexical = rankPublicationItems(question, items, parameters);
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const scores = new Map<string, number>();

  // Zero-score lexical rows carry no query signal and must not receive an RRF
  // contribution merely because they happened to have a low sort_order.
  lexical.filter((entry) => entry.score > 0).forEach((entry, index) => {
    scores.set(entry.item.id, (scores.get(entry.item.id) ?? 0) + (1 / (RRF_K + index + 1)));
  });
  [...new Set(vectorRankedItemIds)].forEach((id, index) => {
    if (!itemsById.has(id)) return;
    scores.set(id, (scores.get(id) ?? 0) + (1 / (RRF_K + index + 1)));
  });

  if (!scores.size) return lexical;
  return [...scores.entries()].map(([id, score]) => ({ item: itemsById.get(id)!, score }))
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return left.item.sort_order - right.item.sort_order;
    });
}

export function selectEvidence(
  question: string,
  items: PublicationItem[],
  vectorRankedItemIds: string[] = [],
  parameters: Readonly<Bm25fParameters> = BM25F_PARAMETERS,
) {
  const ranked = vectorRankedItemIds.length
    ? rankPublicationItemsHybrid(question, items, vectorRankedItemIds, parameters)
    : rankPublicationItems(question, items, parameters);

  const evidence: Evidence[] = [];
  let usedChars = 0;
  for (const candidate of ranked) {
    const itemChars = candidate.item.title.length + candidate.item.content.length;
    if (evidence.length && usedChars + itemChars > MAX_EVIDENCE_CHARS) continue;
    evidence.push({
      ...candidate.item,
      ref: `E${evidence.length + 1}`,
      sources: parseCitationSources(candidate.item.citation_sources),
    });
    usedChars += itemChars;
    if (evidence.length >= MAX_EVIDENCE_ITEMS) break;
  }
  return evidence;
}

export function normalizeModelAnswer(value: unknown, validRefs: Set<string>) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid answer');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'answer,citation_refs,has_material_conflict,status'
    || (record.status !== 'answered' && record.status !== 'unsupported' && record.status !== 'conflict')
    || typeof record.answer !== 'string'
    || typeof record.has_material_conflict !== 'boolean'
    || !Array.isArray(record.citation_refs)) {
    throw new Error('invalid answer');
  }
  const answer = record.answer.trim();
  const refs = record.citation_refs;
  if (!answer || answer.length > 1_600 || refs.length > 5
    || refs.some((ref) => typeof ref !== 'string' || !validRefs.has(ref))
    || new Set(refs).size !== refs.length) {
    throw new Error('invalid answer');
  }
  if (record.status === 'unsupported') {
    if (record.has_material_conflict) throw new Error('invalid answer');
    return { status: 'unsupported' as const, answer: UNSUPPORTED_ANSWER, citationRefs: [] as string[] };
  }
  if (record.status === 'conflict') {
    if (!record.has_material_conflict || refs.length < 2) throw new Error('invalid answer');
    return { status: 'conflict' as const, answer, citationRefs: refs as string[] };
  }
  if (record.has_material_conflict || refs.length === 0) throw new Error('invalid answer');
  return { status: 'answered' as const, answer, citationRefs: refs as string[] };
}
