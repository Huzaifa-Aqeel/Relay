import { isClearlyEquivalentMemoryContent, legacySemanticScore } from './organization-memory.ts';
import type { CaptureProposal } from './organize-proposals.ts';

type Approved = { id: string; knowledge_type: string; title: string; content: string };
export function reconcileProposals(proposals: CaptureProposal[], approved: Approved[]) {
  const scores = proposals.map((proposal) => approved.map((item) => legacySemanticScore(proposal, item)));
  let dropped = 0;
  const output = proposals.flatMap((proposal, i) => {
    // Conservative equality precedes fuzzy topic matching, including non-Latin text.
    if (approved.some((item) => item.knowledge_type === proposal.knowledge_type && isClearlyEquivalentMemoryContent(proposal, item))) {
      dropped++; return [];
    }
    const ranked = approved.map((item, j) => ({ item, j, score: scores[i][j] })).sort((a,b) => b.score-a.score);
    const best = ranked[0];
    if (!best || best.score < 0.25) return [proposal];
    const reverse = scores.map((row, k) => ({ k, score: row[best.j] })).sort((a,b) => b.score-a.score);
    if (best.score >= 0.42 && best.score-(ranked[1]?.score ?? 0) >= 0.12 && reverse[0]?.k === i && best.score-(reverse[1]?.score ?? 0) >= 0.12) {
      return [{ ...proposal, proposal_action: 'update', proposal_target_id: best.item.id }];
    }
    return [{ ...proposal, similar_to_title: best.item.title }];
  });
  return { proposals: output, dropped };
}
