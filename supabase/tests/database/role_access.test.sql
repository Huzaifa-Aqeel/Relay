begin;
select no_plan();
insert into auth.users(id,email) values
('a0000000-0000-4000-8000-000000000001','owner@role.test'),
('a0000000-0000-4000-8000-000000000002','treasurer@role.test'),
('a0000000-0000-4000-8000-000000000003','successor@role.test'),
('a0000000-0000-4000-8000-000000000004','outsider@role.test');
create function pg_temp.actor(n integer) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub','a0000000-0000-4000-8000-' || lpad(n::text,12,'0'),'role','authenticated')::text,true)::text::void;
$$;
create function pg_temp.id(name text) returns uuid language sql as $$ select current_setting('test.' || name)::uuid $$;
create function pg_temp.token(name text) returns text language sql as $$ select current_setting('test.' || name) $$;
select pg_temp.actor(1);
set local role authenticated;
select set_config('test.org',public.create_organization('Multi Role Club','','')::text,true);
select set_config('test.president',public.create_role(pg_temp.id('org'),'President','')::text,true);
select throws_ok($$select public.create_handoff(pg_temp.id('org'),pg_temp.id('president'),'2026–2027')$$,'42501','Active Role Assignment required','Owner alone cannot create a working handoff');
select set_config('test.owner_invite',(public.create_role_assignment_invite(pg_temp.id('president'),'2026–2027')->>'token'),true);
select set_config('test.president_handoff',public.accept_role_assignment_invite(pg_temp.token('owner_invite'))::text,true);
select ok(public.is_role_holder_for_handoff(pg_temp.id('president_handoff')),'Owner explicitly assigned as President can maintain President');
select throws_ok($$select public.accept_role_assignment_invite(pg_temp.token('owner_invite'))$$,'22023','Invite unavailable or expired','Invite is single use');
select throws_ok($$select public.create_role(pg_temp.id('org'),'Treasurer','')$$,'P0001','RELAY_PRO_REQUIRED:role','Free role creation limit remains');

set local role postgres;
insert into public.organization_subscriptions(organization_id,purchaser_user_id,revenuecat_app_user_id,entitlement_id,status)
values(pg_temp.id('org'),'a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','relay_pro','active');
set local role authenticated;
select set_config('test.treasurer',public.create_role(pg_temp.id('org'),'Treasurer','')::text,true);
select set_config('test.treasurer_invite',public.create_role_assignment_invite(pg_temp.id('treasurer'),'2026–2027')->>'token',true);
select pg_temp.actor(2);
select ok(not public.is_organization_member(pg_temp.id('org')),'Invite possession does not create membership');
select is(public.preview_role_assignment_invite(pg_temp.token('treasurer_invite'))->>'roleTitle','Treasurer','Authenticated invite preview identifies the Role');
select is((select count(*) from public.sources),0::bigint,'Invite preview grants no raw source access');
select set_config('test.treasurer_handoff',public.accept_role_assignment_invite(pg_temp.token('treasurer_invite'))::text,true);
select ok(public.is_organization_member(pg_temp.id('org')),'Explicit acceptance activates membership');
select ok(public.is_role_holder_for_handoff(pg_temp.id('treasurer_handoff')),'Treasurer assigned to exact role-period');
select ok(not public.is_role_holder_for_handoff(pg_temp.id('president_handoff')),'Treasurer cannot maintain President');
select is(public.get_organization_plan(pg_temp.id('org'))->>'plan','pro','Role Holder benefits from Organization Pro without purchasing');
select ok(not public.is_organization_admin(pg_temp.id('org')),'Role Holder is not Owner');
select throws_ok($$select public.create_role_assignment_invite(pg_temp.id('president'),'2028–2029')$$,'42501','Owner access required','Role Holder cannot assign roles');
select throws_ok($$update public.organizations set created_by = auth.uid() where id = pg_temp.id('org')$$,'42501',null,'Direct ownership takeover denied');
select throws_ok($$insert into public.organization_members(organization_id,user_id,member_role) values(pg_temp.id('org'),'a0000000-0000-4000-8000-000000000004','admin')$$,'42501',null,'Direct admin invitation denied');
select throws_ok($$select public.mark_preflight_stale_for_handoff(pg_temp.id('president_handoff'))$$,'42501',null,'Internal helper cannot mutate another Role');
insert into public.sources(id,organization_id,handoff_id,created_by,kind,title,text_content)
values('b0000000-0000-4000-8000-000000000001',pg_temp.id('org'),pg_temp.id('treasurer_handoff'),auth.uid(),'typed_text','Private scratch','Private raw context');
insert into public.knowledge_items(id,organization_id,handoff_id,created_by,knowledge_type,title,content,status,origin)
values('c0000000-0000-4000-8000-000000000001',pg_temp.id('org'),pg_temp.id('treasurer_handoff'),auth.uid(),'responsibility','Submit budget','Submit the annual budget to the advisor.','approved','manual');
select throws_ok($$insert into public.sources(organization_id,handoff_id,created_by,kind,title,text_content) values(pg_temp.id('org'),pg_temp.id('president_handoff'),auth.uid(),'typed_text','Attack','No')$$,'42501',null,'Treasurer cannot insert into President');
select throws_ok($$update public.knowledge_items set created_by = 'a0000000-0000-4000-8000-000000000001' where id = 'c0000000-0000-4000-8000-000000000001'$$,'42501',null,'Prior attribution cannot be rewritten');
select throws_ok($$insert into public.sources(id,organization_id,handoff_id,created_by,kind,title,storage_path) values('b0000000-0000-4000-8000-000000000009',pg_temp.id('org'),pg_temp.id('treasurer_handoff'),auth.uid(),'document','Spoof',pg_temp.id('org')::text || '/' || pg_temp.id('president_handoff')::text || '/b0000000-0000-4000-8000-000000000009/file.pdf')$$,'23514',null,'Source path cannot reference another role workspace');

select pg_temp.actor(1);
select is((select count(*) from public.sources where handoff_id = pg_temp.id('treasurer_handoff')),0::bigint,'Unassigned Owner cannot read Treasurer raw sources');
select is((select count(*) from public.knowledge_items where handoff_id = pg_temp.id('treasurer_handoff')),1::bigint,'Owner can inspect approved organizational knowledge');
select ok((public.get_organization_continuity(pg_temp.id('org'))->'roles')::text like '%approvedCount%','Owner overview provides safe continuity counts');
select throws_ok($$select public.begin_handoff_review(pg_temp.id('treasurer_handoff'))$$,'42501','Handoff unavailable','Unassigned Owner cannot review Treasurer');
select throws_ok($$select public.create_role_assignment_invite(pg_temp.id('treasurer'),'2026–2027')$$,'22023','Confirm replacement of the existing Role Holder','Replacement requires deliberate confirmation');
select set_config('test.replacement',public.create_role_assignment_invite(pg_temp.id('treasurer'),'2026–2027',true)->>'token',true);
select pg_temp.actor(3);
select is(public.accept_role_assignment_invite(pg_temp.token('replacement')),pg_temp.id('treasurer_handoff'),'Mid-year replacement continues same handoff');
select is((select count(*) from public.sources where handoff_id = pg_temp.id('treasurer_handoff')),1::bigint,'Replacement inherits private role sources');
select is((select created_by from public.knowledge_items where id = 'c0000000-0000-4000-8000-000000000001'),'a0000000-0000-4000-8000-000000000002'::uuid,'Former holder attribution preserved');
select is((select count(*) from public.role_assignments where role_id = pg_temp.id('treasurer') and service_period = '2026–2027' and status = 'active'),1::bigint,'Exactly one active maintainer');
select pg_temp.actor(2);
select ok(not public.is_role_holder_for_handoff(pg_temp.id('treasurer_handoff')),'Ended holder loses authorization');
select is((select count(*) from public.sources),0::bigint,'Ended holder loses private raw access');
select throws_ok($$select public.begin_handoff_review(pg_temp.id('treasurer_handoff'))$$,'42501','Handoff unavailable','Ended holder cannot edit through RPC');

select pg_temp.actor(3);
select lives_ok($$select public.begin_handoff_review(pg_temp.id('treasurer_handoff'))$$,'Replacement can review inherited workspace');
select set_config('test.run',public.begin_preflight_run(pg_temp.id('treasurer_handoff'))::text,true);
select lives_ok($$select public.complete_preflight_run(pg_temp.id('run'),'[]')$$,'Assigned nonowner can finish Preflight');
select lives_ok($$select public.advance_handoff_to_preview(pg_temp.id('treasurer_handoff'),false)$$,'Assigned nonowner can Preview');
select set_config('test.public_token',public.publish_handoff(pg_temp.id('treasurer_handoff')),true);
select ok(public.get_shared_handoff(pg_temp.token('public_token')) is not null,'Assigned nonowner publishes public recipient snapshot');
select lives_ok($$select public.reopen_handoff_for_revision(pg_temp.id('treasurer_handoff'))$$,'Published workspace can deliberately reopen');
update public.knowledge_items set content = 'Private newer budget instructions.' where id = 'c0000000-0000-4000-8000-000000000001';
insert into public.knowledge_items(organization_id,handoff_id,created_by,knowledge_type,title,content,status,origin)
values(pg_temp.id('org'),pg_temp.id('treasurer_handoff'),auth.uid(),'warning','Unreviewed','Draft-only proposal','proposed','ai'),
(pg_temp.id('org'),pg_temp.id('treasurer_handoff'),auth.uid(),'warning','Rejected','Rejected draft','rejected','ai'),
(pg_temp.id('org'),pg_temp.id('treasurer_handoff'),auth.uid(),'warning','Retired','Retired draft','retired','ai');
select is(public.get_shared_handoff(pg_temp.token('public_token'))->'items'->0->>'content','Submit the annual budget to the advisor.','Routine edits preserve previous public snapshot');
select is((select status from public.handoffs where id = pg_temp.id('treasurer_handoff')),'draft','Routine edits do not auto-publish');

select pg_temp.actor(1);
select set_config('test.next_year',public.create_role_assignment_invite(pg_temp.id('treasurer'),'2027–2028')->>'token',true);
select pg_temp.actor(2);
select set_config('test.next_handoff',public.accept_role_assignment_invite(pg_temp.token('next_year'))::text,true);
select isnt(pg_temp.id('next_handoff'),pg_temp.id('treasurer_handoff'),'New period receives separate workspace');
select is((select count(*) from public.knowledge_items where handoff_id = pg_temp.id('next_handoff')),1::bigint,'Only published approved knowledge is inherited');
select is((select count(*) from public.sources where handoff_id = pg_temp.id('next_handoff')),0::bigint,'Private sources are not inherited across periods');
select is((select content from public.knowledge_items where handoff_id = pg_temp.id('next_handoff')),'Submit the annual budget to the advisor.','Inheritance uses snapshot, not changed private working knowledge');
select is((select inherited_from_service_period from public.knowledge_items where handoff_id = pg_temp.id('next_handoff')),'2026–2027','Inherited period remains identifiable');
select is((select lineage_id from public.knowledge_items where handoff_id = pg_temp.id('next_handoff')),(select knowledge_lineage_id from public.handoff_publication_items where handoff_id = pg_temp.id('treasurer_handoff')),'Cross-period knowledge lineage preserved');
update public.knowledge_items set content = 'Next-year policy requires a September budget.' where handoff_id = pg_temp.id('next_handoff');
select is(public.get_shared_handoff(pg_temp.token('public_token'))->'items'->0->>'content','Submit the annual budget to the advisor.','New-period edits cannot change previous publication');
select is((select count(*) from public.handoff_publications where handoff_id = pg_temp.id('treasurer_handoff')),1::bigint,'Current holder sees previous published role history');

select pg_temp.actor(1);
select set_config('test.transfer',public.request_organization_ownership_transfer(pg_temp.id('org'),'a0000000-0000-4000-8000-000000000002')::text,true);
select ok(public.is_organization_admin(pg_temp.id('org')),'Ownership offer does not automatically transfer');
select throws_ok($$select public.accept_organization_ownership_transfer(pg_temp.id('transfer'))$$,'42501','Transfer unavailable','Only selected recipient can accept ownership');
select pg_temp.actor(2);
select lives_ok($$select public.accept_organization_ownership_transfer(pg_temp.id('transfer'))$$,'Active member explicitly accepts ownership');
select ok(public.is_organization_admin(pg_temp.id('org')),'Accepted recipient is sole Owner');
select ok(not public.is_role_holder_for_handoff(pg_temp.id('president_handoff')),'New ownership grants no President editing');
select is(public.get_organization_plan(pg_temp.id('org'))->>'plan','pro','Ownership transfer preserves Organization Pro');
select pg_temp.actor(1);
select ok(not public.is_organization_admin(pg_temp.id('org')),'Old Owner loses Owner authority');
select ok(public.is_role_holder_for_handoff(pg_temp.id('president_handoff')),'Old Owner retains separately assigned President authority');
select is((select purchaser_user_id from public.organization_subscriptions where organization_id = pg_temp.id('org')),'a0000000-0000-4000-8000-000000000001'::uuid,'Purchaser identity unchanged');

select pg_temp.actor(4);
select is((select count(*) from public.organizations),0::bigint,'Unrelated user sees no Organization data');
select ok(public.get_shared_handoff(pg_temp.token('public_token')) is not null,'Recipient can read publication independently of membership');
select ok(not public.is_organization_member(pg_temp.id('org')),'Recipient link does not confer membership');
select throws_ok($$select public.sync_verified_organization_subscription(auth.uid(),pg_temp.id('org'),'relay_pro',true,'annual','test',null)$$,'42501',null,'Client cannot submit verified subscription state');
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select ok(public.get_shared_handoff(pg_temp.token('public_token')) is not null,'No-login recipient works');
select throws_ok($$select public.accept_role_assignment_invite(pg_temp.token('next_year'))$$,'42501',null,'Anonymous invite acceptance denied');
select throws_ok($$select public.preview_role_assignment_invite(pg_temp.token('next_year'))$$,'42501',null,'Anonymous invite metadata denied');
select throws_ok($$select public.mark_preflight_stale_for_handoff(pg_temp.id('president_handoff'))$$,'42501',null,'Anonymous internal mutation denied');

set local role postgres;
update public.organization_subscriptions set status = 'inactive' where organization_id = pg_temp.id('org');
select pg_temp.actor(2);
set local role authenticated;
select is(public.get_organization_plan(pg_temp.id('org'))->>'plan','free','Expired Organization returns to Free');
select is((select count(*) from public.role_assignments where status = 'active'),3::bigint,'Downgrade preserves assignments');
select ok(public.get_shared_handoff(pg_temp.token('public_token')) is not null,'Downgrade preserves recipient access');
select set_config('test.free_invite',public.create_role_assignment_invite(pg_temp.id('treasurer'),'2028–2029')->>'token',true);
select throws_ok($$select public.accept_role_assignment_invite(pg_temp.token('free_invite'))$$,'P0001','RELAY_PRO_REQUIRED:handoff','Free owner-holder cannot bypass new period gate');
select is((select count(*) from public.role_assignments where service_period = '2028–2029'),0::bigint,'Failed plan check rolls back entire acceptance');
select lives_ok($$select public.end_role_assignment((select id from public.role_assignments where role_id = pg_temp.id('treasurer') and service_period = '2027–2028' and status = 'active'))$$,'Owner deliberately ends assignment');
select ok(not public.is_role_holder_for_handoff(pg_temp.id('next_handoff')),'Ended Owner-holder loses edit authority too');
select throws_ok($$select public.create_role_assignment_invite(pg_temp.id('treasurer'),'2026-27')$$,'22023','Confirm replacement of the existing Role Holder','Equivalent short-year spelling cannot bypass existing assignment');
select throws_ok($$select public.create_role_assignment_invite(pg_temp.id('treasurer'),'2026-2029')$$,'22023','Service period must span consecutive years','Ambiguous period ordering rejected');
select set_config('test.expiring',public.create_role_assignment_invite(pg_temp.id('treasurer'),'2029-30')->>'token',true);
select is(public.preview_role_assignment_invite(pg_temp.token('expiring'))->>'servicePeriod','2029–2030','New service periods normalized');
set local role postgres;
update public.role_assignment_invites set expires_at = now() - interval '1 second' where token_hash = encode(extensions.digest(pg_temp.token('expiring'),'sha256'),'hex');
select throws_ok($$insert into public.role_assignments(organization_id,role_id,user_id,service_period,assigned_by) values(pg_temp.id('org'),pg_temp.id('treasurer'),'a0000000-0000-4000-8000-000000000004','2026–2027','a0000000-0000-4000-8000-000000000002')$$,'23505',null,'Unique index prevents concurrent second active maintainer');
set local role authenticated;
select throws_ok($$select public.accept_role_assignment_invite(pg_temp.token('expiring'))$$,'22023','Invite unavailable or expired','Expired invite cannot be accepted');
select throws_ok($$select public.preview_role_assignment_invite(pg_temp.token('expiring'))$$,'22023','Invite unavailable or expired','Expired invite does not disclose context');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select public.sync_verified_organization_subscription('a0000000-0000-4000-8000-000000000003',pg_temp.id('org'),'relay_pro',true,'annual','test',null)$$,'42501','Only the current Owner can attach a purchase','Even verified purchase cannot attach for nonowner holder');
select throws_ok($$select public.sync_verified_organization_subscription('a0000000-0000-4000-8000-000000000001',pg_temp.id('org'),'relay_pro',true,'annual','test',null)$$,'42501','Only the current Owner can attach a purchase','Former purchaser-owner cannot attach using stale ownership');
select is(public.sync_verified_organization_subscription('a0000000-0000-4000-8000-000000000001',null,'relay_pro',true,'annual','test',null),pg_temp.id('org'),'Existing purchaser can refresh unchanged entitlement after transfer');
select ok(public.organization_has_relay_pro(pg_temp.id('org')),'Verified refresh retains Organization Pro association');
set local role postgres;
select * from finish();
rollback;
