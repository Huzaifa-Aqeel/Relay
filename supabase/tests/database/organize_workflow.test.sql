begin;

select no_plan();

insert into auth.users (id, email)
values ('a1000000-0000-4000-8000-000000000001', 'organize-workflow@example.test');

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select lives_ok(
  $$select public.create_organization('Organize Workflow Test', 'Test Institution', '')$$,
  'the Organize fixture can create its Organization'
);

select lives_ok(
  $$select public.create_role(
    (select id from public.organizations where name = 'Organize Workflow Test'),
    'Program Coordinator',
    ''
  )$$,
  'the Organize fixture can create its Role'
);

set local role postgres;
insert into public.role_assignments (
  organization_id, role_id, user_id, service_period, assigned_by
)
select role.organization_id, role.id,
  'a1000000-0000-4000-8000-000000000001', '2032–2033',
  'a1000000-0000-4000-8000-000000000001'
from public.roles role
where role.title = 'Program Coordinator'
  and role.organization_id = (select id from public.organizations where name = 'Organize Workflow Test');
set local role authenticated;

select lives_ok(
  $$select public.create_handoff(
    (select id from public.organizations where name = 'Organize Workflow Test'),
    (select id from public.roles where title = 'Program Coordinator'
      and organization_id = (select id from public.organizations where name = 'Organize Workflow Test')),
    '2032–2033'
  )$$,
  'the assigned Role Holder can create the Organize fixture Handoff'
);

select lives_ok(
  $$select public.create_capture_draft(
    (select id from public.organizations where name = 'Organize Workflow Test'),
    (select id from public.handoffs where service_period = '2032–2033'),
    'Explicit Organize intent', null,
    'Submit the participation roster through the portal every Wednesday.'
  )$$,
  'the fixture can create its Capture'
);

select lives_ok(
  $$select public.save_capture(
    (select id from public.captures where title = 'Explicit Organize intent'),
    'Explicit Organize intent', null,
    'Submit the participation roster through the portal every Wednesday.',
    array[]::uuid[]
  )$$,
  'the fixture can save its Capture'
);

select lives_ok(
  $$select public.request_capture_organize(
    (select id from public.captures where title = 'Explicit Organize intent')
  )$$,
  'an explicit Organize action records pending intent'
);

select ok(
  (select organize_requested_at is not null
   from public.captures where title = 'Explicit Organize intent'),
  'the Capture records explicit Organize intent while evidence is prepared'
);

set local role postgres;
update public.captures set structuring_status = 'processing'
where title = 'Explicit Organize intent';
set local role authenticated;

select lives_ok(
  $$select public.request_capture_organize(
    (select id from public.captures where title = 'Explicit Organize intent')
  )$$,
  'a duplicate click during model processing is harmless'
);

select ok(
  (select organize_requested_at is null
   from public.captures where title = 'Explicit Organize intent'),
  'a duplicate click does not queue another Organize run behind an active model call'
);

set local role postgres;
alter table public.captures disable trigger captures_set_updated_at;
update public.captures set updated_at = now() - interval '4 minutes'
where title = 'Explicit Organize intent';
alter table public.captures enable trigger captures_set_updated_at;
set local role authenticated;

select public.sweep_stale_capture_processing(
  (select id from public.handoffs where service_period = '2032–2033')
);

select is(
  (select structuring_status from public.captures where title = 'Explicit Organize intent'),
  'failed',
  'an abandoned model job leaves processing after its three-minute lease'
);

set local role postgres;
update public.captures set
  structuring_status = 'not_started',
  structuring_failure_reason = null,
  structured_at = null,
  structured_proposal_count = null,
  structured_dropped_count = null
where title = 'Explicit Organize intent';

insert into public.sources (
  id, organization_id, handoff_id, created_by, kind, title,
  storage_path, mime_type, size_bytes, processing_status,
  created_at, updated_at
) values (
  'a1000000-0000-4000-8000-000000000010',
  (select id from public.organizations where name = 'Organize Workflow Test'),
  (select id from public.handoffs where service_period = '2032–2033'),
  'a1000000-0000-4000-8000-000000000001',
  'document', 'Stale document',
  (select id::text from public.organizations where name = 'Organize Workflow Test') || '/' ||
    (select id::text from public.handoffs where service_period = '2032–2033') ||
    '/a1000000-0000-4000-8000-000000000010/stale.txt',
  'text/plain', 100, 'processing',
  now() - interval '11 minutes', now() - interval '11 minutes'
);

insert into public.sources (
  id, organization_id, handoff_id, created_by, kind, title,
  storage_path, mime_type, size_bytes, processing_status,
  created_at, updated_at
) values (
  'a1000000-0000-4000-8000-000000000011',
  (select id from public.organizations where name = 'Organize Workflow Test'),
  (select id from public.handoffs where service_period = '2032–2033'),
  'a1000000-0000-4000-8000-000000000001',
  'document', 'Fresh document job',
  (select id::text from public.organizations where name = 'Organize Workflow Test') || '/' ||
    (select id::text from public.handoffs where service_period = '2032–2033') ||
    '/a1000000-0000-4000-8000-000000000011/fresh.txt',
  'text/plain', 100, 'processing',
  now() - interval '4 minutes', now() - interval '4 minutes'
);

insert into public.capture_sources (
  capture_id, source_id, organization_id, handoff_id,
  relationship, position, created_for_capture
)
select capture.id, 'a1000000-0000-4000-8000-000000000010',
  capture.organization_id, capture.handoff_id, 'attachment', 1, true
from public.captures capture where capture.title = 'Explicit Organize intent';
set local role authenticated;

select public.request_capture_organize(
  (select id from public.captures where title = 'Explicit Organize intent')
);

select lives_ok(
  $$select public.sweep_stale_capture_processing(
    (select id from public.handoffs where service_period = '2032–2033')
  )$$,
  'normal Capture loading can reap abandoned document processing'
);

select is(
  (select processing_status from public.sources where id = 'a1000000-0000-4000-8000-000000000010'),
  'failed',
  'the stale document becomes retryable'
);

select is(
  (select processing_status from public.sources where id = 'a1000000-0000-4000-8000-000000000011'),
  'processing',
  'the sweep leaves an active document job inside its ten-minute lease alone'
);

select is(
  (select structuring_status from public.captures where title = 'Explicit Organize intent'),
  'failed',
  'the Capture leaves its waiting state when document processing is abandoned'
);

select ok(
  (select organize_requested_at is null
   from public.captures where title = 'Explicit Organize intent'),
  'stale recovery clears the completed explicit-request marker'
);

select * from finish();
rollback;
