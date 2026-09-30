-- Preserve an explicit suppression marker when approved current sources
-- conflict about one atomic topic. Comparison removes the whole topic from
-- both sides instead of misreporting the previous claim as not carried.

alter table public.publication_memory_claims
  drop constraint if exists publication_memory_claims_claim_state_check;

alter table public.publication_memory_claims
  add constraint publication_memory_claims_claim_state_check check (
    claim_state in ('active', 'pending', 'resolved', 'retired', 'uncertain')
  );

comment on column public.publication_memory_claims.claim_state is
  'Derived operational state. uncertain suppresses that topic from comparison; it is never displayed as a Memory change.';
