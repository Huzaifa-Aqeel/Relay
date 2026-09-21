begin;

select plan(184);

insert into auth.users (id, email)
values
  ('33333333-3333-4333-8333-333333333333', 'relay-admin@example.test'),
  ('44444444-4444-4444-8444-444444444444', 'relay-member@example.test');

select set_config(
  'request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}',
  true
);
set local role authenticated;

select is((select count(*) from public.profiles), 1::bigint, 'a user can read only their own profile');
select lives_ok(
  $$select public.claim_push_token('ExponentPushToken[relay-admin-device]', 'android')$$,
  'an authenticated user can securely claim a device token'
);
select is((select count(*) from public.push_tokens), 1::bigint, 'a user can read their registered device token');

select lives_ok(
  $$select public.create_organization('University Robotics Club', 'Northbridge University', 'Builds useful machines.')$$,
  'an authenticated user can create an organization atomically'
);

select is(
  (select count(*) from public.organizations where name = 'University Robotics Club'),
  1::bigint,
  'the creator can read the new organization'
);

select is(
  (
    select member_role
    from public.organization_members
    where user_id = '33333333-3333-4333-8333-333333333333'
  ),
  'admin',
  'the organization creator becomes its admin'
);

select throws_ok(
  $$select public.create_organization('Second Free Organization', '', '')$$,
  'P0001',
  'RELAY_PRO_REQUIRED:organization',
  'the free plan permits one owned organization'
);

select lives_ok(
  $$select public.create_role(
    (select id from public.organizations where name = 'University Robotics Club'),
    'President',
    'Coordinates the organization.'
  )$$,
  'an organization admin can create the free role through the guarded RPC'
);

update public.roles
set id = '55555555-5555-4555-8555-555555555555'
where title = 'President';

select is((select count(*) from public.roles), 1::bigint, 'the admin can read the role');

select throws_ok(
  $$select public.create_role(
    (select id from public.organizations where name = 'University Robotics Club'),
    'Treasurer',
    ''
  )$$,
  'P0001',
  'RELAY_PRO_REQUIRED:role',
  'the free plan permits one active role'
);

select lives_ok(
  $$select public.create_handoff(
    (select organization_id from public.roles where id = '55555555-5555-4555-8555-555555555555'),
    '55555555-5555-4555-8555-555555555555',
    '2026–2027'
  )$$,
  'an organization admin can start the free handoff through the guarded RPC'
);

update public.handoffs
set id = '66666666-6666-4666-8666-666666666666'
where service_period = '2026–2027';

select throws_ok(
  $$select public.create_handoff(
    (select organization_id from public.roles where id = '55555555-5555-4555-8555-555555555555'),
    '55555555-5555-4555-8555-555555555555',
    '2027–2028'
  )$$,
  'P0001',
  'RELAY_PRO_REQUIRED:handoff',
  'the free plan permits one current handoff'
);

select is(
  (select status from public.handoffs where id = '66666666-6666-4666-8666-666666666666'),
  'draft',
  'a new handoff begins as a draft'
);

select is(
  (select stage from public.handoffs where id = '66666666-6666-4666-8666-666666666666'),
  'capture',
  'a new handoff begins at Capture'
);

select lives_ok(
  $$
    insert into public.sources (
      id, organization_id, handoff_id, created_by, kind, title, text_content
    )
    values (
      '77777777-7777-4777-8777-777777777777',
      (select organization_id from public.handoffs where id = '66666666-6666-4666-8666-666666666666'),
      '66666666-6666-4666-8666-666666666666',
      '33333333-3333-4333-8333-333333333333',
      'typed_text',
      'RoboFest notes',
      'Book the hall early and speak to Facilities.'
    )
  $$,
  'an admin can save original typed source material'
);

select is((select count(*) from public.sources), 1::bigint, 'the admin can read the handoff source');

select lives_ok(
  $$
    insert into public.knowledge_items (
      id, organization_id, handoff_id, created_by, knowledge_type, title, content, status, origin
    )
    values (
      '88888888-8888-4888-8888-888888888888',
      (select organization_id from public.handoffs where id = '66666666-6666-4666-8666-666666666666'),
      '66666666-6666-4666-8666-666666666666',
      '33333333-3333-4333-8333-333333333333',
      'process',
      'Reserve the venue',
      'Submit the venue request twelve weeks before RoboFest.',
      'approved',
      'manual'
    )
  $$,
  'an admin can add approved knowledge manually'
);

select is(
  (select status from public.knowledge_items where id = '88888888-8888-4888-8888-888888888888'),
  'approved',
  'manual knowledge is stored as approved truth'
);

select lives_ok(
  $$
    insert into public.knowledge_item_sources (
      knowledge_item_id, source_id, handoff_id, organization_id, source_excerpt
    )
    values (
      '88888888-8888-4888-8888-888888888888',
      '77777777-7777-4777-8777-777777777777',
      '66666666-6666-4666-8666-666666666666',
      (select organization_id from public.handoffs where id = '66666666-6666-4666-8666-666666666666'),
      'Book the hall early.'
    )
  $$,
  'knowledge can retain provenance to its source'
);

select is((select count(*) from public.knowledge_item_sources), 1::bigint, 'provenance is readable by the admin');

select lives_ok(
  $$
    insert into public.knowledge_items (
      id, organization_id, handoff_id, created_by, knowledge_type, title, content, status, origin
    )
    values (
      '99999999-9999-4999-8999-999999999999',
      (select organization_id from public.handoffs where id = '66666666-6666-4666-8666-666666666666'),
      '66666666-6666-4666-8666-666666666666',
      '33333333-3333-4333-8333-333333333333',
      'warning',
      'Do not leave booking late',
      'The organization nearly lost the venue last year.',
      'approved',
      'manual'
    )
  $$,
  'an admin can add another approved item'
);

select ok(
  (select sort_order from public.knowledge_items where id = '99999999-9999-4999-8999-999999999999')
    > (select sort_order from public.knowledge_items where id = '88888888-8888-4888-8888-888888888888'),
  'new knowledge receives a stable order after existing knowledge'
);

select lives_ok(
  $$select public.move_knowledge_item('99999999-9999-4999-8999-999999999999', 'up')$$,
  'an admin can reorder approved knowledge'
);

select is(
  (
    select title from public.knowledge_items
    where handoff_id = '66666666-6666-4666-8666-666666666666'
    order by sort_order, created_at, id limit 1
  ),
  'Do not leave booking late',
  'reordering changes the approved handoff order'
);

select throws_ok(
  $$
    insert into public.knowledge_items (
      organization_id, handoff_id, created_by, knowledge_type, title, content, status, origin
    )
    values (
      (select organization_id from public.handoffs where id = '66666666-6666-4666-8666-666666666666'),
      '66666666-6666-4666-8666-666666666666',
      '33333333-3333-4333-8333-333333333333',
      'lesson', 'Invalid manual proposal', 'Manual truth cannot bypass approval rules.', 'proposed', 'manual'
    )
  $$,
  '23514',
  null,
  'manual entries cannot masquerade as AI proposals'
);

select lives_ok(
  $$
    insert into public.knowledge_items (
      id, organization_id, handoff_id, created_by, knowledge_type, title, content, status, origin,
      uncertainty_note
    )
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      (select organization_id from public.handoffs where id = '66666666-6666-4666-8666-666666666666'),
      '66666666-6666-4666-8666-666666666666',
      '33333333-3333-4333-8333-333333333333',
      'contact',
      'Sarah in Facilities',
      'Sarah coordinates Engineering Hall reservations.',
      'proposed',
      'ai',
      'The source does not include a phone number or email address.'
    )
  $$,
  'AI knowledge can enter the review queue only as proposed'
);

select lives_ok(
  $$select public.begin_handoff_review('66666666-6666-4666-8666-666666666666')$$,
  'an admin can begin review when knowledge exists'
);

select is(
  (select stage from public.handoffs where id = '66666666-6666-4666-8666-666666666666'),
  'review',
  'beginning review advances the handoff stage'
);

select lives_ok(
  $$select public.decide_knowledge_proposal('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'approved')$$,
  'an admin can accept an AI proposal'
);

select is(
  (select status from public.knowledge_items where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'approved',
  'accepted AI knowledge becomes approved truth'
);

select throws_ok(
  $$select public.decide_knowledge_proposal('88888888-8888-4888-8888-888888888888', 'rejected')$$,
  '22023',
  null,
  'manual approved knowledge cannot be handled as an AI proposal'
);

select lives_ok(
  $$select public.return_handoff_to_capture('66666666-6666-4666-8666-666666666666')$$,
  'an admin can return a draft to Capture'
);

select is(
  (select stage from public.handoffs where id = '66666666-6666-4666-8666-666666666666'),
  'capture',
  'returning to Capture updates the handoff stage'
);

select lives_ok(
  $$
    update public.sources
    set structuring_status = 'processing'
    where id = '77777777-7777-4777-8777-777777777777'
  $$,
  'an admin can start structuring a ready source'
);

select lives_ok(
  $$
    select public.replace_source_knowledge_proposals(
      '77777777-7777-4777-8777-777777777777',
      '[{
        "knowledge_type": "process",
        "title": "Book the hall",
        "content": "Book the hall early through Facilities.",
        "uncertainty_note": "The source does not define how early.",
        "source_excerpt": "Book the hall early and speak to Facilities.",
        "source_locator": null
      }]'::jsonb
    )
  $$,
  'validated model output is stored atomically as proposed knowledge'
);

select is(
  (select structuring_status from public.sources where id = '77777777-7777-4777-8777-777777777777'),
  'ready',
  'successful structuring marks the source ready'
);

select is(
  (select structured_proposal_count from public.sources where id = '77777777-7777-4777-8777-777777777777'),
  1,
  'the source records how many proposals were created'
);

select is(
  (
    select link.source_excerpt
    from public.knowledge_item_sources link
    join public.knowledge_items item on item.id = link.knowledge_item_id
    where item.title = 'Book the hall' and item.origin = 'ai'
  ),
  'Book the hall early and speak to Facilities.',
  'each generated proposal retains exact source evidence'
);

update public.sources
set structuring_status = 'processing', structured_at = null, structured_proposal_count = null
where id = '77777777-7777-4777-8777-777777777777';

select throws_ok(
  $$
    select public.replace_source_knowledge_proposals(
      '77777777-7777-4777-8777-777777777777',
      '[{
        "knowledge_type": "deadline",
        "title": "Invented deadline",
        "content": "Book twelve weeks ahead.",
        "uncertainty_note": null,
        "source_excerpt": "twelve weeks ahead",
        "source_locator": null
      }]'::jsonb
    )
  $$,
  '22023',
  null,
  'proposal evidence must be present verbatim in the source'
);

select is(
  (select structuring_status from public.sources where id = '77777777-7777-4777-8777-777777777777'),
  'processing',
  'invalid proposals roll back without falsely marking structuring ready'
);

update public.sources
set text_content = text_content || ' Keep the confirmation email.'
where id = '77777777-7777-4777-8777-777777777777';

select is(
  (select structuring_status from public.sources where id = '77777777-7777-4777-8777-777777777777'),
  'not_started',
  'editing source evidence resets its structuring state'
);

delete from public.knowledge_items
where title = 'Book the hall' and origin = 'ai' and status = 'proposed';

set local role postgres;

select ok(
  exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sources'
  ),
  'source status changes are published through Supabase Realtime'
);

select is(
  (select public from storage.buckets where id = 'handoff-sources'),
  false,
  'handoff source storage is private'
);

select is(
  (select file_size_limit from storage.buckets where id = 'handoff-sources'),
  26214400::bigint,
  'handoff source files are capped at 25 MB'
);

set local role authenticated;

select lives_ok(
  $$
    insert into storage.objects (bucket_id, name)
    values (
      'handoff-sources',
      (select organization_id::text from public.handoffs where id = '66666666-6666-4666-8666-666666666666')
        || '/66666666-6666-4666-8666-666666666666/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/guide.pdf'
    )
  $$,
  'an admin can upload a private handoff source file'
);

select lives_ok(
  $$
    insert into public.sources (
      id, organization_id, handoff_id, created_by, kind, title, storage_path, mime_type,
      size_bytes, processing_status
    )
    values (
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      (select organization_id from public.handoffs where id = '66666666-6666-4666-8666-666666666666'),
      '66666666-6666-4666-8666-666666666666',
      '33333333-3333-4333-8333-333333333333',
      'document',
      'Planning guide',
      (select organization_id::text from public.handoffs where id = '66666666-6666-4666-8666-666666666666')
        || '/66666666-6666-4666-8666-666666666666/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/guide.pdf',
      'application/pdf',
      1024,
      'processing'
    )
  $$,
  'an uploaded document can be tracked as a processing source'
);

select lives_ok(
  $$
    update public.sources
    set processing_status = 'failed', failure_reason = 'Processing service unavailable.'
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  $$,
  'a processing failure retains the source with a plain-language reason'
);

select is(
  (select processing_status from public.sources where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  'failed',
  'the document exposes its failed processing state'
);

set local role postgres;
insert into public.organization_subscriptions (
  organization_id, purchaser_user_id, revenuecat_app_user_id, entitlement_id, status,
  product_identifier, store, revenuecat_checked_at
) values (
  (select organization_id from public.handoffs where id = '66666666-6666-4666-8666-666666666666'),
  '33333333-3333-4333-8333-333333333333',
  '33333333-3333-4333-8333-333333333333', 'relay_pro', 'active',
  'relay_pro_annual', 'play_store', now()
);
set local role authenticated;

select is((select count(*) from public.organization_subscriptions), 1::bigint, 'a purchaser can read their server-written organization association');

with changed as (
  update public.organization_subscriptions
  set status = 'inactive'
  where purchaser_user_id = '33333333-3333-4333-8333-333333333333'
  returning 1
)
select is(
  (select count(*) from changed),
  0::bigint,
  'a client cannot grant or remove its own entitlement'
);

select throws_ok(
  $$select public.create_handoff(
    (select organization_id from public.roles where id = '55555555-5555-4555-8555-555555555555'),
    '55555555-5555-4555-8555-555555555555',
    '2026–2027'
  )$$,
  '23505',
  null,
  'a role cannot have duplicate handoffs for one service period'
);

select throws_ok(
  $$select public.create_role(
    (select organization_id from public.roles where id = '55555555-5555-4555-8555-555555555555'),
    ' president ',
    ''
  )$$,
  '23505',
  null,
  'active role titles are unique without case or surrounding-space tricks'
);

select ok(
  public.is_organization_admin((select organization_id from public.roles where id = '55555555-5555-4555-8555-555555555555')),
  'the creator is recognized as an organization admin'
);

select lives_ok(
  $$
    insert into public.organization_members (organization_id, user_id, member_role)
    values (
      (select organization_id from public.roles where id = '55555555-5555-4555-8555-555555555555'),
      '44444444-4444-4444-8444-444444444444',
      'member'
    )
  $$,
  'an admin can add an authenticated organization member'
);

update public.sources
set structuring_status = 'processing', structured_at = null, structured_proposal_count = null
where id = '77777777-7777-4777-8777-777777777777';

select set_config(
  'request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',
  true
);

select is((select count(*) from public.profiles), 1::bigint, 'a member cannot read another user profile');
select is((select count(*) from public.push_tokens), 0::bigint, 'a member cannot read another user device token');
select is((select count(*) from public.organization_subscriptions), 0::bigint, 'a member cannot read another purchaser billing association');
select is(
  public.get_organization_plan((select organization_id from public.organization_members where user_id = '44444444-4444-4444-8444-444444444444'))->>'plan',
  'pro',
  'an organization member receives the organization plan without owning the purchase'
);
select is((select count(*) from public.organizations), 1::bigint, 'a member can read their organization');
select is((select count(*) from public.roles), 1::bigint, 'a member can read organization roles');
select is((select count(*) from public.handoffs), 1::bigint, 'a member can read organization handoffs');
select is((select count(*) from public.sources), 2::bigint, 'a member can read organization sources');
select is((select count(*) from storage.objects where bucket_id = 'handoff-sources'), 1::bigint, 'a member can read private source files for their organization');
select is((select count(*) from public.knowledge_items), 3::bigint, 'a member can read organization knowledge');
select is((select count(*) from public.knowledge_item_sources), 1::bigint, 'a member can read knowledge provenance');
select ok(
  not public.is_organization_admin((select organization_id from public.organization_members where user_id = '44444444-4444-4444-8444-444444444444')),
  'a normal member is not treated as an admin'
);

select throws_ok(
  $$
    insert into public.roles (organization_id, created_by, title)
    values (
      (select organization_id from public.organization_members where user_id = '44444444-4444-4444-8444-444444444444'),
      '44444444-4444-4444-8444-444444444444',
      'Treasurer'
    )
  $$,
  '42501',
  null,
  'a normal member cannot create roles'
);

select throws_ok(
  $$
    insert into public.organizations (created_by, name)
    values ('44444444-4444-4444-8444-444444444444', 'Bypass Organization')
  $$,
  '42501',
  null,
  'clients cannot bypass atomic organization creation'
);

select throws_ok(
  $$
    insert into public.sources (organization_id, handoff_id, created_by, kind, title, text_content)
    values (
      (select organization_id from public.handoffs where id = '66666666-6666-4666-8666-666666666666'),
      '66666666-6666-4666-8666-666666666666',
      '44444444-4444-4444-8444-444444444444',
      'typed_text', 'Unauthorized notes', 'A normal member should not be able to add this.'
    )
  $$,
  '42501',
  null,
  'a normal member cannot create handoff sources'
);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name)
    values (
      'handoff-sources',
      (select organization_id::text from public.handoffs where id = '66666666-6666-4666-8666-666666666666')
        || '/66666666-6666-4666-8666-666666666666/cccccccc-cccc-4ccc-8ccc-cccccccccccc/unauthorized.pdf'
    )
  $$,
  '42501',
  null,
  'a normal member cannot upload handoff source files'
);

select throws_ok(
  $$select public.move_knowledge_item('88888888-8888-4888-8888-888888888888', 'down')$$,
  '42501',
  null,
  'a normal member cannot reorder approved knowledge'
);

select throws_ok(
  $$select public.begin_handoff_review('66666666-6666-4666-8666-666666666666')$$,
  '42501',
  null,
  'a normal member cannot advance the handoff lifecycle'
);

select throws_ok(
  $$select public.decide_knowledge_proposal('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rejected')$$,
  '42501',
  null,
  'a normal member cannot decide knowledge proposals'
);

select throws_ok(
  $$select public.replace_source_knowledge_proposals('77777777-7777-4777-8777-777777777777', '[]'::jsonb)$$,
  '42501',
  null,
  'a normal member cannot store AI proposals'
);

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is((select count(*) from public.profiles), 0::bigint, 'anonymous users cannot read profiles');
select is((select count(*) from public.push_tokens), 0::bigint, 'anonymous users cannot read device tokens');
select is((select count(*) from public.organization_subscriptions), 0::bigint, 'anonymous users cannot read organization subscription state');
select is((select count(*) from public.organizations), 0::bigint, 'anonymous users cannot read organizations');
select is((select count(*) from public.roles), 0::bigint, 'anonymous users cannot read roles');
select is((select count(*) from public.handoffs), 0::bigint, 'anonymous users cannot read draft handoffs');
select is((select count(*) from public.sources), 0::bigint, 'anonymous users cannot read handoff sources');
select is((select count(*) from public.knowledge_items), 0::bigint, 'anonymous users cannot read approved knowledge');
select is((select count(*) from public.knowledge_item_sources), 0::bigint, 'anonymous users cannot read provenance');
select is((select count(*) from storage.objects where bucket_id = 'handoff-sources'), 0::bigint, 'anonymous users cannot read private source files');
select throws_ok(
  $$select public.create_organization('Anonymous Organization', '', '')$$,
  '42501',
  null,
  'anonymous users cannot create organizations'
);

select throws_ok(
  $$select public.move_knowledge_item('88888888-8888-4888-8888-888888888888', 'up')$$,
  '42501',
  null,
  'anonymous users cannot reorder knowledge'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}',
  true
);

select lives_ok(
  $$select public.begin_handoff_review('66666666-6666-4666-8666-666666666666')$$,
  'the admin can return the current handoff to Review before Preflight'
);

select lives_ok(
  $$select public.begin_preflight_run('66666666-6666-4666-8666-666666666666')$$,
  'an admin can begin Preflight after every proposal has a decision'
);

select is(
  (select stage from public.handoffs where id = '66666666-6666-4666-8666-666666666666'),
  'preflight',
  'starting Preflight advances the handoff stage'
);

select is(
  (select status from public.preflight_runs where handoff_id = '66666666-6666-4666-8666-666666666666'),
  'processing',
  'a new Preflight run has an explicit processing state'
);

select throws_ok(
  $$select public.begin_preflight_run('66666666-6666-4666-8666-666666666666')$$,
  '55000',
  null,
  'a handoff cannot start two concurrent Preflight runs'
);

select throws_ok(
  $test$
    select public.complete_preflight_run(
      (select id from public.preflight_runs where status = 'processing'),
      jsonb_build_array(jsonb_build_object(
        'finding_type', 'contradiction',
        'severity', 'critical',
        'title', 'Conflicting venue instructions',
        'question', 'Which venue instruction should the successor follow?',
        'explanation', 'A contradiction needs evidence from both sides.',
        'suggested_knowledge_type', 'process',
        'primary_knowledge_item_id', '88888888-8888-4888-8888-888888888888',
        'evidence', jsonb_build_array(jsonb_build_object(
          'evidence_kind', 'knowledge',
          'knowledge_item_id', '88888888-8888-4888-8888-888888888888',
          'source_id', null,
          'label', 'Reserve the venue',
          'excerpt', 'Submit the venue request twelve weeks before RoboFest.',
          'locator', null
        ))
      ))
    )
  $test$,
  '22023',
  null,
  'a claimed contradiction is rejected unless it cites at least two pieces of evidence'
);

select is(
  (select count(*) from public.preflight_findings),
  0::bigint,
  'invalid Preflight output rolls back without partial findings'
);

select is(
  (
    select public.complete_preflight_run(
      (select id from public.preflight_runs where status = 'processing'),
      jsonb_build_array(jsonb_build_object(
        'finding_type', 'ambiguous',
        'severity', 'critical',
        'title', 'Facilities contact is incomplete',
        'question', 'How should the next president contact Sarah in Facilities?',
        'explanation', 'The handoff names the contact but gives no reliable contact method.',
        'suggested_knowledge_type', 'contact',
        'primary_knowledge_item_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'evidence', jsonb_build_array(
          jsonb_build_object(
            'evidence_kind', 'knowledge',
            'knowledge_item_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'source_id', null,
            'label', 'Sarah in Facilities',
            'excerpt', 'Sarah coordinates Engineering Hall reservations.',
            'locator', null
          ),
          jsonb_build_object(
            'evidence_kind', 'source',
            'knowledge_item_id', null,
            'source_id', '77777777-7777-4777-8777-777777777777',
            'label', 'RoboFest notes',
            'excerpt', 'Book the hall early and speak to Facilities.',
            'locator', null
          )
        )
      ))
    )
  ),
  1,
  'valid evidence-backed findings complete a Preflight run atomically'
);

select is(
  (
    select status || ':' || finding_count::text
    from public.preflight_runs
    order by created_at desc, id desc
    limit 1
  ),
  'ready:1',
  'a completed Preflight records ready state and its finding count'
);

select is(
  (select count(*) from public.preflight_finding_evidence),
  2::bigint,
  'Preflight retains exact knowledge and source evidence snapshots'
);

select throws_ok(
  $$select public.advance_handoff_to_preview('66666666-6666-4666-8666-666666666666', false)$$,
  '22023',
  null,
  'critical unresolved findings block Preview without deliberate acknowledgement'
);

select lives_ok(
  $$
    select public.decide_preflight_finding(
      (select id from public.preflight_findings where title = 'Facilities contact is incomplete'),
      'unknown'
    )
  $$,
  'the admin can honestly mark a Preflight answer unknown'
);

select is(
  (select status from public.preflight_findings where title = 'Facilities contact is incomplete'),
  'unknown',
  'an unknown decision remains visible rather than pretending to resolve the issue'
);

select throws_ok(
  $$select public.advance_handoff_to_preview('66666666-6666-4666-8666-666666666666', false)$$,
  '22023',
  null,
  'marking a critical finding unknown still requires acknowledgement'
);

select is(
  (
    select public.resolve_preflight_finding(
      (select id from public.preflight_findings where title = 'Facilities contact is incomplete'),
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'contact',
      'Sarah in Facilities',
      'Contact Sarah through facilities@northbridge.example for Engineering Hall reservations.'
    )
  ),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'a finding can be resolved by atomically improving existing approved knowledge'
);

select is(
  (select status from public.preflight_findings where title = 'Facilities contact is incomplete'),
  'resolved',
  'resolving a finding records its decision explicitly'
);

select is(
  (select status from public.preflight_runs order by created_at asc, id asc limit 1),
  'stale',
  'material knowledge changes make the completed Preflight stale'
);

select is(
  (select stage from public.handoffs where id = '66666666-6666-4666-8666-666666666666'),
  'review',
  'resolving a finding returns the draft to Review before rerunning Preflight'
);

select lives_ok(
  $$select public.begin_preflight_run('66666666-6666-4666-8666-666666666666')$$,
  'Preflight can rerun after a material resolution'
);

select is(
  (
    select public.complete_preflight_run(
      (select id from public.preflight_runs where status = 'processing'),
      jsonb_build_array(
        jsonb_build_object(
          'finding_type', 'incomplete',
          'severity', 'critical',
          'title', 'Venue confirmation owner is missing',
          'question', 'Who confirms that the venue request was accepted?',
          'explanation', 'The process has no accountable person for confirmation.',
          'suggested_knowledge_type', 'responsibility',
          'primary_knowledge_item_id', '88888888-8888-4888-8888-888888888888',
          'evidence', jsonb_build_array(jsonb_build_object(
            'evidence_kind', 'knowledge',
            'knowledge_item_id', '88888888-8888-4888-8888-888888888888',
            'source_id', null,
            'label', 'Reserve the venue',
            'excerpt', 'Submit the venue request twelve weeks before RoboFest.',
            'locator', null
          ))
        ),
        jsonb_build_object(
          'finding_type', 'missing',
          'severity', 'optional',
          'title', 'Confirmation storage is unspecified',
          'question', 'Where should the venue confirmation be stored?',
          'explanation', 'A shared location would make the confirmation easier to find.',
          'suggested_knowledge_type', 'resource',
          'primary_knowledge_item_id', null,
          'evidence', jsonb_build_array(jsonb_build_object(
            'evidence_kind', 'source',
            'knowledge_item_id', null,
            'source_id', '77777777-7777-4777-8777-777777777777',
            'label', 'RoboFest notes',
            'excerpt', 'Keep the confirmation email.',
            'locator', null
          ))
        )
      )
    )
  ),
  2,
  'a rerun can retain both critical and optional findings'
);

select is(
  (
    select count(*) from public.preflight_findings
    where run_id = (select id from public.preflight_runs where status = 'ready')
  ),
  2::bigint,
  'the readiness record exposes every unresolved finding without a percentage score'
);

select lives_ok(
  $$
    select public.decide_preflight_finding(
      (select id from public.preflight_findings where title = 'Confirmation storage is unspecified'),
      'skipped'
    )
  $$,
  'an optional finding can be deliberately skipped for now'
);

select lives_ok(
  $$
    select public.decide_preflight_finding(
      (select id from public.preflight_findings where title = 'Venue confirmation owner is missing'),
      'unknown'
    )
  $$,
  'a critical finding can remain visibly unknown'
);

select throws_ok(
  $$select public.advance_handoff_to_preview('66666666-6666-4666-8666-666666666666', false)$$,
  '22023',
  null,
  'critical unknown findings cannot silently pass into Preview'
);

select lives_ok(
  $$select public.advance_handoff_to_preview('66666666-6666-4666-8666-666666666666', true)$$,
  'an admin can explicitly acknowledge critical unresolved findings and continue'
);

select is(
  (select stage from public.handoffs where id = '66666666-6666-4666-8666-666666666666'),
  'preview',
  'deliberate critical acknowledgement advances the draft to Preview'
);

select ok(
  (
    select critical_acknowledged_at is not null and critical_acknowledged_by = '33333333-3333-4333-8333-333333333333'
    from public.preflight_runs
    where status = 'ready'
  ),
  'critical acknowledgement records the accountable actor and time'
);

select lives_ok(
  $$
    update public.sources
    set text_content = text_content || ' Save it in the shared drive.'
    where id = '77777777-7777-4777-8777-777777777777'
  $$,
  'source evidence can still be corrected after Preview'
);

select is(
  (
    select status from public.preflight_runs
    where finding_count = 2
    order by created_at desc, id desc limit 1
  ),
  'stale',
  'changing source evidence invalidates the prior readiness result'
);

select is(
  (select stage from public.handoffs where id = '66666666-6666-4666-8666-666666666666'),
  'review',
  'a stale result moves Preview back to Review'
);

select lives_ok(
  $$select public.begin_preflight_run('66666666-6666-4666-8666-666666666666')$$,
  'Preflight can run again after source evidence changes'
);

select is(
  (
    select public.complete_preflight_run(
      (select id from public.preflight_runs where status = 'processing'),
      jsonb_build_array(jsonb_build_object(
        'finding_type', 'missing',
        'severity', 'optional',
        'title', 'Backup contact is optional',
        'question', 'Would a backup Facilities contact be useful?',
        'explanation', 'The primary contact is actionable; a backup would add resilience.',
        'suggested_knowledge_type', 'contact',
        'primary_knowledge_item_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'evidence', jsonb_build_array(jsonb_build_object(
          'evidence_kind', 'knowledge',
          'knowledge_item_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'source_id', null,
          'label', 'Sarah in Facilities',
          'excerpt', 'Contact Sarah through facilities@northbridge.example for Engineering Hall reservations.',
          'locator', null
        ))
      ))
    )
  ),
  1,
  'Preflight can complete with only optional improvements'
);

select lives_ok(
  $$select public.advance_handoff_to_preview('66666666-6666-4666-8666-666666666666', false)$$,
  'optional unresolved findings do not block Preview'
);

select is(
  (select stage from public.handoffs where id = '66666666-6666-4666-8666-666666666666'),
  'preview',
  'the handoff reaches Preview without a false critical acknowledgement'
);

select is(
  (
    select critical_acknowledged_at
    from public.preflight_runs
    where status = 'ready'
    order by created_at desc, id desc limit 1
  ),
  null,
  'optional-only readiness does not fabricate a critical acknowledgement'
);

select lives_ok(
  $$
    update public.sources
    set text_content = text_content || ' Keep the request number too.'
    where id = '77777777-7777-4777-8777-777777777777'
  $$,
  'a further material change correctly invalidates optional-only readiness'
);

select lives_ok(
  $$select public.begin_preflight_run('66666666-6666-4666-8666-666666666666')$$,
  'a fresh processing run can start after the latest change'
);

select lives_ok(
  $$
    update public.knowledge_items
    set content = content || ' Retain the request number.'
    where id = '88888888-8888-4888-8888-888888888888'
  $$,
  'approved knowledge remains editable during a processing attempt'
);

select is(
  (
    select status from public.preflight_runs
    where failure_reason = 'Knowledge changed while Preflight was running. Run it again with the current handoff.'
    order by started_at desc limit 1
  ),
  'failed',
  'a material change during processing fails the run instead of publishing stale readiness'
);

select is(
  (select stage from public.handoffs where id = '66666666-6666-4666-8666-666666666666'),
  'review',
  'a concurrent material change safely returns the draft to Review'
);

set local role postgres;

select ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'preflight_runs'
  ),
  'Preflight run completion is delivered through Supabase Realtime'
);

select ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'preflight_findings'
  ),
  'Preflight finding decisions are delivered through Supabase Realtime'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',
  true
);

select is((select count(*) from public.preflight_runs), 4::bigint, 'an organization member can read its Preflight history');
select is((select count(*) from public.preflight_findings), 4::bigint, 'an organization member can read its Preflight findings');
select is((select count(*) from public.preflight_finding_evidence), 5::bigint, 'an organization member can read cited Preflight evidence');

select throws_ok(
  $$select public.begin_preflight_run('66666666-6666-4666-8666-666666666666')$$,
  '42501',
  null,
  'a normal member cannot start Preflight'
);

select throws_ok(
  $$
    select public.decide_preflight_finding(
      (select id from public.preflight_findings where title = 'Backup contact is optional'),
      'skipped'
    )
  $$,
  '42501',
  null,
  'a normal member cannot decide Preflight findings'
);

select throws_ok(
  $$
    select public.resolve_preflight_finding(
      (select id from public.preflight_findings where title = 'Backup contact is optional'),
      null,
      'contact',
      'Backup contact',
      'Use the Facilities office as the backup contact.'
    )
  $$,
  '42501',
  null,
  'a normal member cannot resolve Preflight findings'
);

select throws_ok(
  $$select public.advance_handoff_to_preview('66666666-6666-4666-8666-666666666666', true)$$,
  '42501',
  null,
  'a normal member cannot advance the handoff from Preflight'
);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*) from public.preflight_runs), 0::bigint, 'anonymous users cannot read Preflight runs');
select is((select count(*) from public.preflight_findings), 0::bigint, 'anonymous users cannot read Preflight findings');
select is((select count(*) from public.preflight_finding_evidence), 0::bigint, 'anonymous users cannot read Preflight evidence');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}',
  true
);

select lives_ok(
  $$select public.begin_preflight_run('66666666-6666-4666-8666-666666666666')$$,
  'the admin can run the final Preflight before publication'
);

select is(
  (
    select public.complete_preflight_run(
      (select id from public.preflight_runs where status = 'processing'),
      '[]'::jsonb
    )
  ),
  0,
  'a fully actionable handoff can complete Preflight with no findings'
);

select lives_ok(
  $$select public.advance_handoff_to_preview('66666666-6666-4666-8666-666666666666', false)$$,
  'a ready handoff can advance to exact Preview'
);

select is(
  char_length(public.publish_handoff('66666666-6666-4666-8666-666666666666')),
  64,
  'publishing creates a 256-bit-style opaque access token'
);

select is(
  (
    select status || ':' || stage
    from public.handoffs where id = '66666666-6666-4666-8666-666666666666'
  ),
  'published:published',
  'publication atomically advances the handoff lifecycle'
);

select is(
  (
    select status from public.handoff_publications
    where handoff_id = '66666666-6666-4666-8666-666666666666'
  ),
  'active',
  'a newly published recipient link is active'
);

select is(
  (select count(*) from public.handoff_publication_items),
  3::bigint,
  'publication snapshots only the three approved Knowledge Items'
);

select is(
  (
    select content from public.handoff_publication_items
    where source_knowledge_item_id = '88888888-8888-4888-8888-888888888888'
  ),
  'Submit the venue request twelve weeks before RoboFest. Retain the request number.',
  'the publication snapshot contains the exact approved content from Preview'
);

select is(
  (
    select citation_sources->0->>'label' from public.handoff_publication_items
    where source_knowledge_item_id = '88888888-8888-4888-8888-888888888888'
  ),
  'RoboFest notes',
  'publication snapshots safe citation labels for grounded recipient answers'
);

select set_config(
  'relay.test_old_token',
  (select access_token from public.handoff_publications where handoff_id = '66666666-6666-4666-8666-666666666666'),
  true
);

select throws_ok(
  $$select * from public.claim_public_ask_request(current_setting('relay.test_old_token'), 1, 2)$$,
  '42501',
  null,
  'clients cannot increment or bypass public Ask usage directly'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(
  (select remaining from public.claim_public_ask_request(current_setting('relay.test_old_token'), 1, 2)),
  1,
  'a Pro handoff receives its larger server-claimed Ask allowance'
);
select is(
  (select remaining from public.claim_public_ask_request(current_setting('relay.test_old_token'), 1, 2)),
  0,
  'Ask usage is incremented atomically'
);
select throws_ok(
  $$select * from public.claim_public_ask_request(current_setting('relay.test_old_token'), 1, 2)$$,
  'P0001',
  'ASK_LIMIT_REACHED',
  'the public Ask limit is enforced before another provider call'
);
select is((select request_count from public.ask_usage_daily), 2, 'failed Ask claims do not over-increment usage');

set local role postgres;
update public.organization_subscriptions
set status = 'inactive', expires_at = now() - interval '1 minute', revenuecat_checked_at = now()
where purchaser_user_id = '33333333-3333-4333-8333-333333333333';
select is(
  (select count(*) from public.handoffs where created_by = '33333333-3333-4333-8333-333333333333'),
  1::bigint,
  'a subscription downgrade never deletes an existing handoff'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}',
  true
);

select is(
  public.get_organization_plan((select id from public.organizations where name = 'University Robotics Club'))->>'plan',
  'free',
  'an expired organization subscription resolves to Free without deleting its data'
);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select is((select count(*) from public.handoff_publications), 0::bigint, 'anonymous recipients cannot read publication records directly');
select is((select count(*) from public.handoff_publication_items), 0::bigint, 'anonymous recipients cannot query snapshot tables directly');

select is(
  public.get_shared_handoff(current_setting('relay.test_old_token'))->>'roleTitle',
  'President',
  'a valid token opens the published role without authentication'
);

select is(
  jsonb_array_length(public.get_shared_handoff(current_setting('relay.test_old_token'))->'items'),
  3,
  'the no-login recipient payload contains every approved snapshot item'
);

select ok(
  not (public.get_shared_handoff(current_setting('relay.test_old_token')) ? 'sources')
    and not (public.get_shared_handoff(current_setting('relay.test_old_token')) ? 'organizationId')
    and not (public.get_shared_handoff(current_setting('relay.test_old_token')) ? 'handoffId'),
  'the public payload excludes sources and private authorization identifiers'
);

select is(
  public.get_shared_handoff(repeat('0', 64)),
  null,
  'an unknown token reveals no handoff information'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}',
  true
);

with changed as (
  update public.knowledge_items
  set content = 'This must not replace a published snapshot.'
  where id = '88888888-8888-4888-8888-888888888888'
  returning 1
)
select is(
  (select count(*) from changed),
  0::bigint,
  'published Knowledge Items are frozen against direct editing'
);

select throws_ok(
  $$
    insert into public.sources (organization_id, handoff_id, created_by, kind, title, text_content)
    values (
      (select organization_id from public.handoffs where id = '66666666-6666-4666-8666-666666666666'),
      '66666666-6666-4666-8666-666666666666',
      '33333333-3333-4333-8333-333333333333',
      'typed_text', 'Late private source', 'This cannot mutate a published handoff.'
    )
  $$,
  '42501',
  null,
  'new source evidence cannot be attached after publication'
);

with changed as (
  update public.handoffs
  set stage = 'review'
  where id = '66666666-6666-4666-8666-666666666666'
  returning 1
)
select is(
  (select count(*) from changed),
  0::bigint,
  'clients cannot bypass the published lifecycle with a direct handoff update'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',
  true
);

select is((select count(*) from public.handoff_publications), 0::bigint, 'normal members cannot read owner access tokens');
select is((select count(*) from public.handoff_publication_items), 0::bigint, 'normal members cannot read private snapshot storage directly');

select throws_ok(
  $$select public.publish_handoff('66666666-6666-4666-8666-666666666666')$$,
  '42501',
  null,
  'a normal member cannot publish a handoff'
);

select throws_ok(
  $$select public.revoke_handoff_link('66666666-6666-4666-8666-666666666666')$$,
  '42501',
  null,
  'a normal member cannot revoke recipient access'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}',
  true
);

select lives_ok(
  $$select public.revoke_handoff_link('66666666-6666-4666-8666-666666666666')$$,
  'the owner can revoke recipient access without deleting the handoff'
);

select is(
  (select status from public.handoff_publications where handoff_id = '66666666-6666-4666-8666-666666666666'),
  'revoked',
  'revocation is retained as explicit publication state'
);

select is(
  (select status from public.handoffs where id = '66666666-6666-4666-8666-666666666666'),
  'published',
  'revoking a link does not delete or unpublish the underlying handoff'
);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select is(
  public.get_shared_handoff(current_setting('relay.test_old_token')),
  null,
  'a revoked link immediately stops returning recipient data'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}',
  true
);

select is(
  char_length(public.replace_handoff_link('66666666-6666-4666-8666-666666666666')),
  64,
  'the owner can create a replacement access token'
);

select isnt(
  (select access_token from public.handoff_publications where handoff_id = '66666666-6666-4666-8666-666666666666'),
  current_setting('relay.test_old_token'),
  'replacement invalidates the compromised token instead of reusing it'
);

select is(
  (select status from public.handoff_publications where handoff_id = '66666666-6666-4666-8666-666666666666'),
  'active',
  'replacement reactivates recipient access'
);

select set_config(
  'relay.test_new_token',
  (select access_token from public.handoff_publications where handoff_id = '66666666-6666-4666-8666-666666666666'),
  true
);

select is(
  public.get_shared_handoff(current_setting('relay.test_old_token')),
  null,
  'the replaced token remains unusable'
);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select is(
  public.get_shared_handoff(current_setting('relay.test_new_token'))->>'organizationName',
  'University Robotics Club',
  'the replacement link opens the same snapshot without login'
);

select is(
  jsonb_array_length(public.get_shared_handoff(current_setting('relay.test_new_token'))->'items'),
  3,
  'link replacement preserves the published approved snapshot'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}',
  true
);

select is(
  (select count(*) from public.handoff_publications),
  1::bigint,
  'link replacement does not create duplicate publication records'
);

set local role postgres;
update public.organization_subscriptions
set status = 'active', expires_at = null, revenuecat_checked_at = now()
where purchaser_user_id = '33333333-3333-4333-8333-333333333333';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}',
  true
);

select lives_ok(
  $$select public.create_organization('Alumni Council', '', '')$$,
  'an active purchaser can create another organization'
);

select is(
  public.get_organization_plan((select id from public.organizations where name = 'Alumni Council'))->>'plan',
  'free',
  'the purchaser subscription does not unlock an unrelated organization'
);

select lives_ok(
  $$select public.create_role(
    (select id from public.organizations where name = 'Alumni Council'),
    'Chair',
    ''
  )$$,
  'the unrelated Free organization can create its included role'
);

select throws_ok(
  $$select public.create_role(
    (select id from public.organizations where name = 'Alumni Council'),
    'Secretary',
    ''
  )$$,
  'P0001',
  'RELAY_PRO_REQUIRED:role',
  'organization-scoped gating blocks a second role in an unrelated Free organization'
);

select lives_ok(
  $$select public.create_role(
    (select id from public.organizations where name = 'University Robotics Club'),
    'Treasurer',
    ''
  )$$,
  'the organization associated with Relay Pro can create another role'
);

set local role postgres;
insert into public.organization_subscriptions (
  organization_id, purchaser_user_id, revenuecat_app_user_id, entitlement_id, status,
  product_identifier, store, revenuecat_checked_at
) values (
  (select id from public.organizations where name = 'University Robotics Club'),
  '33333333-3333-4333-8333-333333333333',
  '33333333-3333-4333-8333-333333333333', 'relay_pro', 'active',
  'relay_pro_annual', 'play_store', now()
)
on conflict (revenuecat_app_user_id, entitlement_id) do update
set revenuecat_checked_at = excluded.revenuecat_checked_at;

select is(
  (select count(*) from public.organization_subscriptions where revenuecat_app_user_id = '33333333-3333-4333-8333-333333333333'),
  1::bigint,
  'reconciliation does not create a duplicate subscription association'
);

select * from finish();
rollback;
