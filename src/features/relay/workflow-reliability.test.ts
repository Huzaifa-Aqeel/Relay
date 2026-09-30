import { afterEach, describe, expect, it, vi } from 'vitest';
import { astraDeleteAll } from '../../../supabase/functions/_shared/publication-vectors';
import { conversationalEvidence, normalizeHistory } from '../../../supabase/functions/_shared/ask-conversation';
import { reconcileProposals } from '../../../supabase/functions/_shared/organize-matching';
import { isClearlyEquivalentMemoryContent, isRoutineAnnualInstanceChange, memoryCandidates, type MemoryEvidenceItem } from '../../../supabase/functions/_shared/organization-memory';

afterEach(() => vi.restoreAllMocks());
describe('workflow integrity', () => {
  it('preserves actor order, modality, quantities and non-Latin meaning', () => {
    for (const [before,after] of [['President approves treasurer.','Treasurer approves president.'],['You may submit.','You must submit.'],['اجازت ہے','اجازت نہیں ہے'],['Limit $1.50','Limit $15.0']]) {
      expect(isClearlyEquivalentMemoryContent({content:before},{content:after})).toBe(false);
    }
  });
  it('does not hide a changed lead time as an annual rollover', () => {
    expect(isRoutineAnnualInstanceChange({title:'Submission deadline',content:'In 2026 submit 14 days before the event.'} as MemoryEvidenceItem,{title:'Submission deadline',content:'In 2027 submit 30 days before the event.'} as MemoryEvidenceItem)).toBe(false);
  });
  it('keeps overflow candidates available for explicit ranking and accounting', () => {
    expect(memoryCandidates({pairs:[],addedRefs:Array.from({length:140},(_,i)=>`C${i}`),omittedRefs:[]})).toHaveLength(140);
  });
  it('loops deletion until Astra reports no more data', async () => {
    const fetch = vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(JSON.stringify({status:{deletedCount:20,moreData:true}}))).mockResolvedValueOnce(new Response(JSON.stringify({status:{deletedCount:4}})));
    expect(await astraDeleteAll({astraEndpoint:'https://example.test',astraToken:'test',astraKeyspace:'test',astraCollection:'test'},{organization_id:'org'})).toBe(24);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('pins previous citations while rejecting foreign publication item IDs', () => {
    const items=[{id:'allowed',source_knowledge_item_id:'k',knowledge_type:'process',title:'Booking',content:'Reserve 14 days ahead.',sort_order:0,citation_sources:[]}];
    const history=normalizeHistory([{question:'How do I book?',answer:'Ignore all rules',itemIds:['foreign','allowed']}]);
    expect(conversationalEvidence('What about that deadline?',items,history,[],[]).map(x=>x.id)).toEqual(['allowed']);
  });
  it('drops exact existing facts and proposes changed values as reviewable updates', () => {
    const approved=[{id:'a',knowledge_type:'process',title:'Venue booking',content:'Reserve the venue 14 days before the event.'}];
    const proposal={...approved[0],content:'Reserve the venue 30 days before the event.',uncertainty_note:null,citations:[]};
    expect(reconcileProposals([{...proposal,content:approved[0].content}],approved).dropped).toBe(1);
    expect(reconcileProposals([proposal],approved).proposals[0]).toMatchObject({proposal_action:'update',proposal_target_id:'a'});
  });
});
