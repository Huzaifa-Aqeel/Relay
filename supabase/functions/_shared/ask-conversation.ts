import { rankPublicationItemsHybrid, selectEvidence, type PublicationItem } from './ask-relay-logic.ts';

export type AskTurn = { question: string; answer: string; itemIds: string[] };

export function normalizeHistory(value: unknown): AskTurn[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-3).flatMap((turn) => {
    if (!turn || typeof turn !== 'object' || typeof turn.question !== 'string' || typeof turn.answer !== 'string') return [];
    return [{ question: turn.question.slice(0, 500), answer: turn.answer.slice(0, 1600),
      itemIds: Array.isArray(turn.itemIds) ? turn.itemIds.filter((id: unknown): id is string => typeof id === 'string').slice(0, 5) : [] }];
  });
}

export function conversationalEvidence(question: string, items: PublicationItem[], history: AskTurn[], latestVector: string[], contextualVector: string[]) {
  const previous = history.at(-1);
  if (!previous) return selectEvidence(question, items, latestVector);
  const scores = new Map<string, number>();
  for (const ranked of [rankPublicationItemsHybrid(question, items, latestVector), rankPublicationItemsHybrid(`${previous.question}\n${question}`, items, contextualVector)]) {
    ranked.filter((entry) => entry.score > 0).forEach((entry, i) => scores.set(entry.item.id, (scores.get(entry.item.id) ?? 0) + 1 / (61 + i)));
  }
  const validIds = new Set(items.map((item) => item.id));
  const pinned = previous.itemIds.filter((id) => validIds.has(id));
  const rankedIds = [...new Set([...pinned, ...[...scores].sort((a,b) => b[1] - a[1]).map(([id]) => id)])];
  // Pre-ranked input keeps previous citations first without letting client text become evidence.
  const selected = rankedIds.map((id) => items.find((item) => item.id === id)!);
  return selectEvidence('', selected.map((item, sort_order) => ({ ...item, sort_order })));
}
