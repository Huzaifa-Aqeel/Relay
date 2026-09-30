begin;

select no_plan();

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'role_memory_changes'
      and column_name = 'reason_statement' and is_nullable = 'YES'
  ),
  'simplified Memory has an optional evidence-backed reason statement'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'role_memory_changes'
      and column_name = 'reason_provenance' and is_nullable = 'NO'
  ),
  'Memory keeps reason provenance separate from before and after provenance'
);

select ok(
  position(
    'not_carried_forward' in (
      select pg_get_constraintdef(oid)
      from pg_constraint
      where conrelid = 'public.role_memory_changes'::regclass
        and conname = 'role_memory_changes_change_type_check'
    )
  ) = 0,
  'previous-only knowledge is not an Organization Memory result type'
);

select ok(
  to_regprocedure('public.commit_role_memory_comparison(uuid,uuid,uuid,uuid,text,text,uuid,jsonb)') is not null,
  'complete Memory results are committed through one atomic RPC'
);

select ok(to_regclass('public.role_memory_topics') is not null,
  'atomic Memory topics are installed');
select ok(to_regclass('public.publication_memory_indexes') is not null,
  'publication Memory index state is installed');
select ok(to_regclass('public.publication_memory_claims') is not null,
  'publication Memory claims are installed');
select ok(
  to_regprocedure('public.commit_publication_memory_claim_indexes(uuid,uuid,uuid[],uuid,integer,jsonb)') is not null,
  'derived Memory claims are committed atomically'
);
select ok(
  position(
    '''uncertain'''
    in pg_get_functiondef(
      'public.commit_publication_memory_claim_indexes(uuid,uuid,uuid[],uuid,integer,jsonb)'::regprocedure
    )
  ) > 0,
  'the atomic claim commit accepts uncertainty suppression markers'
);

select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'role_memory_changes'
     and column_name in (
       'reason_category', 'reason_explanation', 'reason_evidence',
       'human_confirmed', 'confirmed_by', 'confirmed_at'
     )),
  0::bigint,
  'the obsolete causal taxonomy and confirmation columns are removed'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'handoff_publication_items'
      and column_name = 'knowledge_lineage_id' and is_nullable = 'YES'
  ),
  'legacy/imported immutable publications may remain readable without lineage'
);

select ok(to_regclass('public.knowledge_relationships') is null,
  'obsolete lesson-to-process relationship storage is removed');
select ok(to_regprocedure('public.confirm_memory_change_reason(uuid,text,text)') is null,
  'the obsolete reason confirmation RPC is removed');
select ok(to_regprocedure('public.confirm_memory_change_reason_v13(uuid,text,text,uuid)') is null,
  'the obsolete v1.3 reason confirmation RPC is removed');

select ok(
  position(
    'item.status = ''approved''' in pg_get_functiondef('public.publish_handoff(uuid)'::regprocedure)
  ) > 0,
  'publication snapshots only approved Knowledge Items for later comparison'
);

select ok(
  to_regprocedure('public.preserve_adjacent_publication_lineage()') is not null,
  'publication-time adjacent lineage preservation is installed'
);

select ok(
  exists (
    select 1
    from pg_trigger trigger
    join pg_class relation on relation.oid = trigger.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'handoff_publication_items'
      and trigger.tgname = 'handoff_publication_items_preserve_adjacent_lineage'
      and not trigger.tgisinternal
  ),
  'publication items apply adjacent lineage preservation before insertion'
);

select ok(
  position(
    'previous_item.knowledge_type = new.knowledge_type'
    in pg_get_functiondef('public.preserve_adjacent_publication_lineage()'::regprocedure)
  ) > 0,
  'publication lineage requires the same exact knowledge category'
);

select ok(
  position(
    'publication.period_start_year < current_handoff.period_start_year'
    in pg_get_functiondef('public.preserve_adjacent_publication_lineage()'::regprocedure)
  ) > 0,
  'publication lineage searches only backward from the current service period'
);

select is(
  (select count(*) from pg_policies
   where schemaname = 'public' and tablename = 'role_memory_comparisons'
     and cmd = 'SELECT' and qual like '%can_view_role_history%'),
  1::bigint,
  'comparison reads retain Role-history RLS authorization'
);

select is(
  (select count(*) from pg_policies
   where schemaname = 'public' and tablename = 'role_memory_changes'
     and cmd = 'SELECT' and qual like '%can_view_role_history%'),
  1::bigint,
  'change reads retain Role-history RLS authorization'
);

select is(
  (select count(*) from pg_policies
   where schemaname = 'public'
     and tablename in ('role_memory_topics', 'publication_memory_indexes', 'publication_memory_claims')
     and cmd = 'SELECT' and qual like '%can_view_role_history%'),
  3::bigint,
  'atomic Memory index reads retain Role-history RLS authorization'
);

-- Publication-time behavior: the new immutable snapshot may reuse continuity,
-- while both the previous snapshot and the clean current Draft stay unchanged.
insert into auth.users (id, email)
values ('a2000000-0000-4000-8000-000000000001', 'memory-lineage@example.test');

insert into public.organizations (id, created_by, name)
values (
  'a2000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000001',
  'Memory Lineage Test'
);

insert into public.roles (id, organization_id, created_by, title)
values (
  'a2000000-0000-4000-8000-000000000003',
  'a2000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000001',
  'Operations Lead'
);

insert into public.handoffs (
  id, organization_id, role_id, created_by, service_period, status, stage, published_at
) values
  (
    'a2000000-0000-4000-8000-000000000010',
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000003',
    'a2000000-0000-4000-8000-000000000001',
    '2026–2027', 'published', 'published', now() - interval '2 years'
  ),
  (
    'a2000000-0000-4000-8000-000000000011',
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000003',
    'a2000000-0000-4000-8000-000000000001',
    '2027–2028', 'published', 'published', now() - interval '1 year'
  ),
  (
    'a2000000-0000-4000-8000-000000000012',
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000003',
    'a2000000-0000-4000-8000-000000000001',
    '2028–2029', 'draft', 'preview', null
  );

insert into public.knowledge_items (
  id, organization_id, handoff_id, created_by, knowledge_type, title,
  content, status, origin, sort_order
) values
  (
    'a2000000-0000-4000-8000-000000000020',
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000010',
    'a2000000-0000-4000-8000-000000000001',
    'rule_deadline', 'Non-adjacent filing', 'File the request by August 1.',
    'approved', 'manual', 1000
  ),
  (
    'a2000000-0000-4000-8000-000000000021',
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000011',
    'a2000000-0000-4000-8000-000000000001',
    'process', 'Annual registration', 'Submit registration through the portal.',
    'approved', 'manual', 1000
  ),
  (
    'a2000000-0000-4000-8000-000000000022',
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000011',
    'a2000000-0000-4000-8000-000000000001',
    'process', 'Room request deadline', 'Submit the room request in advance.',
    'approved', 'manual', 2000
  ),
  (
    'a2000000-0000-4000-8000-000000000023',
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000011',
    'a2000000-0000-4000-8000-000000000001',
    'process', 'Room-request deadline!', 'Confirm the room request in advance.',
    'approved', 'manual', 3000
  ),
  (
    'a2000000-0000-4000-8000-000000000024',
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000012',
    'a2000000-0000-4000-8000-000000000001',
    'process', ' Annual Registration ', 'Submit registration through the new portal.',
    'approved', 'manual', 1000
  ),
  (
    'a2000000-0000-4000-8000-000000000025',
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000012',
    'a2000000-0000-4000-8000-000000000001',
    'rule_deadline', 'Non-adjacent filing', 'File the request by July 15.',
    'approved', 'manual', 2000
  ),
  (
    'a2000000-0000-4000-8000-000000000026',
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000012',
    'a2000000-0000-4000-8000-000000000001',
    'process', 'Room request deadline', 'Submit the room request six weeks ahead.',
    'approved', 'manual', 3000
  );

insert into public.handoff_publications (
  id, organization_id, handoff_id, access_token, status, organization_name,
  role_title, service_period, published_by, published_at
) values
  (
    'a2000000-0000-4000-8000-000000000030',
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000010', repeat('a', 64), 'active',
    'Memory Lineage Test', 'Operations Lead', '2026–2027',
    'a2000000-0000-4000-8000-000000000001', now() - interval '2 years'
  ),
  (
    'a2000000-0000-4000-8000-000000000031',
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000011', repeat('b', 64), 'active',
    'Memory Lineage Test', 'Operations Lead', '2027–2028',
    'a2000000-0000-4000-8000-000000000001', now() - interval '1 year'
  ),
  (
    'a2000000-0000-4000-8000-000000000032',
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000012', repeat('c', 64), 'active',
    'Memory Lineage Test', 'Operations Lead', '2028–2029',
    'a2000000-0000-4000-8000-000000000001', now()
  );

insert into public.handoff_publication_items (
  id, publication_id, organization_id, handoff_id, source_knowledge_item_id,
  knowledge_lineage_id, knowledge_type, title, content, sort_order, citation_sources
) values
  (
    'a2000000-0000-4000-8000-000000000040',
    'a2000000-0000-4000-8000-000000000030',
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000010',
    'a2000000-0000-4000-8000-000000000020',
    (select lineage_id from public.knowledge_items where id = 'a2000000-0000-4000-8000-000000000020'),
    'rule_deadline', 'Non-adjacent filing', 'File the request by August 1.', 1000, '[]'::jsonb
  ),
  (
    'a2000000-0000-4000-8000-000000000041',
    'a2000000-0000-4000-8000-000000000031',
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000011',
    'a2000000-0000-4000-8000-000000000021',
    (select lineage_id from public.knowledge_items where id = 'a2000000-0000-4000-8000-000000000021'),
    'process', 'Annual registration', 'Submit registration through the portal.', 1000, '[]'::jsonb
  ),
  (
    'a2000000-0000-4000-8000-000000000042',
    'a2000000-0000-4000-8000-000000000031',
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000011',
    'a2000000-0000-4000-8000-000000000022',
    (select lineage_id from public.knowledge_items where id = 'a2000000-0000-4000-8000-000000000022'),
    'process', 'Room request deadline', 'Submit the room request in advance.', 2000, '[]'::jsonb
  ),
  (
    'a2000000-0000-4000-8000-000000000043',
    'a2000000-0000-4000-8000-000000000031',
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000011',
    'a2000000-0000-4000-8000-000000000023',
    (select lineage_id from public.knowledge_items where id = 'a2000000-0000-4000-8000-000000000023'),
    'process', 'Room-request deadline!', 'Confirm the room request in advance.', 3000, '[]'::jsonb
  );

insert into public.handoff_publication_items (
  id, publication_id, organization_id, handoff_id, source_knowledge_item_id,
  knowledge_lineage_id, knowledge_type, title, content, sort_order, citation_sources
) values
  (
    'a2000000-0000-4000-8000-000000000044',
    'a2000000-0000-4000-8000-000000000032',
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000012',
    'a2000000-0000-4000-8000-000000000024',
    (select lineage_id from public.knowledge_items where id = 'a2000000-0000-4000-8000-000000000024'),
    'process', ' Annual Registration ', 'Submit registration through the new portal.', 1000, '[]'::jsonb
  ),
  (
    'a2000000-0000-4000-8000-000000000045',
    'a2000000-0000-4000-8000-000000000032',
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000012',
    'a2000000-0000-4000-8000-000000000025',
    (select lineage_id from public.knowledge_items where id = 'a2000000-0000-4000-8000-000000000025'),
    'rule_deadline', 'Non-adjacent filing', 'File the request by July 15.', 2000, '[]'::jsonb
  ),
  (
    'a2000000-0000-4000-8000-000000000046',
    'a2000000-0000-4000-8000-000000000032',
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000012',
    'a2000000-0000-4000-8000-000000000026',
    (select lineage_id from public.knowledge_items where id = 'a2000000-0000-4000-8000-000000000026'),
    'process', 'Room request deadline', 'Submit the room request six weeks ahead.', 3000, '[]'::jsonb
  );

select is(
  (select knowledge_lineage_id from public.handoff_publication_items
   where id = 'a2000000-0000-4000-8000-000000000044'),
  (select knowledge_lineage_id from public.handoff_publication_items
   where id = 'a2000000-0000-4000-8000-000000000041'),
  'one adjacent normalized-title and category match reuses publication lineage'
);

select isnt(
  (select knowledge_lineage_id from public.handoff_publication_items
   where id = 'a2000000-0000-4000-8000-000000000045'),
  (select knowledge_lineage_id from public.handoff_publication_items
   where id = 'a2000000-0000-4000-8000-000000000040'),
  'lineage matching never skips the adjacent publication to search an older period'
);

select is(
  (select knowledge_lineage_id from public.handoff_publication_items
   where id = 'a2000000-0000-4000-8000-000000000045'),
  (select lineage_id from public.knowledge_items
   where id = 'a2000000-0000-4000-8000-000000000025'),
  'zero adjacent matches keep the new publication lineage'
);

select is(
  (select knowledge_lineage_id from public.handoff_publication_items
   where id = 'a2000000-0000-4000-8000-000000000046'),
  (select lineage_id from public.knowledge_items
   where id = 'a2000000-0000-4000-8000-000000000026'),
  'multiple adjacent matches keep the new publication lineage'
);

select is(
  (select knowledge_lineage_id from public.handoff_publication_items
   where id = 'a2000000-0000-4000-8000-000000000041'),
  (select lineage_id from public.knowledge_items
   where id = 'a2000000-0000-4000-8000-000000000021'),
  'the immutable previous publication lineage remains unchanged'
);

select isnt(
  (select lineage_id from public.knowledge_items
   where id = 'a2000000-0000-4000-8000-000000000024'),
  (select knowledge_lineage_id from public.handoff_publication_items
   where id = 'a2000000-0000-4000-8000-000000000044'),
  'publication matching does not rewrite the clean current Draft item'
);

select lives_ok(
  $$select public.commit_publication_memory_claim_indexes(
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000003',
    array[
      'a2000000-0000-4000-8000-000000000031'::uuid,
      'a2000000-0000-4000-8000-000000000032'::uuid
    ],
    'a2000000-0000-4000-8000-000000000001',
    1,
    jsonb_build_array(
      jsonb_build_object(
        'publicationId', 'a2000000-0000-4000-8000-000000000031',
        'topicId', null,
        'topicGroup', 'pair:annual.registration',
        'topicKey', 'annual.registration',
        'topicLabel', 'Annual registration',
        'knowledgeType', 'process',
        'title', 'Annual registration',
        'content', 'Submit registration through the portal.',
        'comparisonValue', 'submit registration through portal',
        'claimState', 'active',
        'primaryPublicationItemId', 'a2000000-0000-4000-8000-000000000041',
        'sourcePublicationItemIds', jsonb_build_array('a2000000-0000-4000-8000-000000000041'),
        'citationSources', '[]'::jsonb
      ),
      jsonb_build_object(
        'publicationId', 'a2000000-0000-4000-8000-000000000032',
        'topicId', null,
        'topicGroup', 'pair:annual.registration',
        'topicKey', 'annual.registration',
        'topicLabel', 'Annual registration',
        'knowledgeType', 'process',
        'title', 'Annual registration',
        'content', 'Submit registration through the new portal.',
        'comparisonValue', 'submit registration through new portal',
        'claimState', 'active',
        'primaryPublicationItemId', 'a2000000-0000-4000-8000-000000000044',
        'sourcePublicationItemIds', jsonb_build_array('a2000000-0000-4000-8000-000000000044'),
        'citationSources', '[]'::jsonb
      )
    )
  )$$,
  'an adjacent pair of atomic claims commits successfully'
);

select is(
  (select count(*) from public.publication_memory_claims
   where publication_id in (
     'a2000000-0000-4000-8000-000000000031',
     'a2000000-0000-4000-8000-000000000032'
   )),
  2::bigint,
  'one atomic claim is stored for each indexed publication'
);

select is(
  (select count(distinct topic_id) from public.publication_memory_claims
   where publication_id in (
     'a2000000-0000-4000-8000-000000000031',
     'a2000000-0000-4000-8000-000000000032'
   )),
  1::bigint,
  'the same operational fact preserves one topic across adjacent publications'
);

select throws_ok(
  $$select public.commit_publication_memory_claim_indexes(
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000003',
    array['a2000000-0000-4000-8000-000000000032'::uuid],
    'a2000000-0000-4000-8000-000000000001',
    1,
    jsonb_build_array(jsonb_build_object(
      'publicationId', 'a2000000-0000-4000-8000-000000000032',
      'topicId', null,
      'topicGroup', 'new:invalid.source',
      'topicKey', 'invalid.source',
      'topicLabel', 'Invalid source',
      'knowledgeType', 'process',
      'title', 'Invalid source',
      'content', 'This source belongs to another publication.',
      'comparisonValue', 'invalid',
      'claimState', 'active',
      'primaryPublicationItemId', 'a2000000-0000-4000-8000-000000000041',
      'sourcePublicationItemIds', jsonb_build_array('a2000000-0000-4000-8000-000000000041'),
      'citationSources', '[]'::jsonb
    ))
  )$$,
  '22023', null,
  'a claim cannot cite an approved item from another publication'
);

select is(
  (select count(*) from public.publication_memory_claims
   where publication_id = 'a2000000-0000-4000-8000-000000000032'),
  1::bigint,
  'a failed claim replacement preserves the complete prior index atomically'
);

select lives_ok(
  $$select public.commit_role_memory_comparison(
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000003',
    'a2000000-0000-4000-8000-000000000031',
    'a2000000-0000-4000-8000-000000000032',
    '2027–2028', '2028–2029',
    'a2000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'changeType', 'added',
      'title', 'Current operational addition',
      'summary', 'This approved knowledge was added in the current published handoff.',
      'previousPublicationItemId', null,
      'currentPublicationItemId', 'a2000000-0000-4000-8000-000000000044',
      'matchBasis', 'not_applicable',
      'reasonStatement', null,
      'beforeSnapshot', null,
      'afterSnapshot', jsonb_build_object(
        'id', 'a2000000-0000-4000-8000-000000000044',
        'sourceKnowledgeItemId', 'a2000000-0000-4000-8000-000000000024',
        'knowledgeType', 'process',
        'title', 'Current operational addition',
        'content', 'Submit registration through the new portal.',
        'citationSources', '[]'::jsonb
      ),
      'supportingProvenance', '[]'::jsonb,
      'reasonProvenance', '[]'::jsonb
    ))
  )$$,
  'a complete truthful comparison commits successfully'
);

select throws_ok(
  $$select public.commit_role_memory_comparison(
    'a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000003',
    'a2000000-0000-4000-8000-000000000031',
    'a2000000-0000-4000-8000-000000000032',
    '2027–2028', '2028–2029',
    'a2000000-0000-4000-8000-000000000001',
    '[{"changeType":"invalid","title":"Invalid","summary":"Invalid result","previousPublicationItemId":null,"currentPublicationItemId":null,"matchBasis":"not_applicable","reasonStatement":null,"beforeSnapshot":null,"afterSnapshot":null,"supportingProvenance":[],"reasonProvenance":[]}]'::jsonb
  )$$,
  '23514', null,
  'an invalid replacement is rejected atomically'
);

select is(
  (
    select count(*)
    from public.role_memory_changes change
    join public.role_memory_comparisons comparison on comparison.id = change.comparison_id
    where comparison.role_id = 'a2000000-0000-4000-8000-000000000003'
      and comparison.previous_publication_id = 'a2000000-0000-4000-8000-000000000031'
      and comparison.current_publication_id = 'a2000000-0000-4000-8000-000000000032'
      and change.change_type = 'added'
  ),
  1::bigint,
  'a failed rerun preserves the last complete ready comparison'
);

select set_config('relay.memory_run', public.claim_memory_run(
 'a2000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000003',
 'a2000000-0000-4000-8000-000000000031','a2000000-0000-4000-8000-000000000032',
 '2027–2028','2028–2029','a2000000-0000-4000-8000-000000000001',2)::text,true);
select ok((current_setting('relay.memory_run')::jsonb ? 'runId'),'a stale comparison gets an exclusive run lease');
select is(public.claim_memory_run(
 'a2000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000003',
 'a2000000-0000-4000-8000-000000000031','a2000000-0000-4000-8000-000000000032',
 '2027–2028','2028–2029','a2000000-0000-4000-8000-000000000001',2)->>'joined','true','concurrent callers join the active lease');
select throws_ok($$select public.finish_memory_run(
 (current_setting('relay.memory_run')::jsonb->>'comparisonId')::uuid,
 gen_random_uuid(),'[]',4,4,0,2)$$,'P0001','Memory run lease expired','a stale worker cannot commit');
select lives_ok($$select public.finish_memory_run(
 (current_setting('relay.memory_run')::jsonb->>'comparisonId')::uuid,
 (current_setting('relay.memory_run')::jsonb->>'runId')::uuid,'[]',4,4,0,2)$$,'the lease owner commits a complete result');
select is(public.claim_memory_run(
 'a2000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000003',
 'a2000000-0000-4000-8000-000000000031','a2000000-0000-4000-8000-000000000032',
 '2027–2028','2028–2029','a2000000-0000-4000-8000-000000000001',2)->>'ready','true','unchanged inputs reuse a complete versioned result');
select ok(not has_function_privilege('authenticated','public.claim_memory_run(uuid,uuid,uuid,uuid,text,text,uuid,integer)','execute'),'clients cannot bypass authorization to claim runs');
select * from finish();
rollback;
