-- Apply to a local database reset through 202609210015, before applying the collaboration migrations.
insert into auth.users(id,email) values('e0000000-0000-4000-8000-000000000001','legacy-owner@relay.test');
insert into public.organizations(id,created_by,name) values('e0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001','Legacy migration fixture');
insert into public.organization_members(organization_id,user_id,member_role) values('e0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001','admin');
insert into public.roles(id,organization_id,created_by,title) values('e0000000-0000-4000-8000-000000000003','e0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001','President');
insert into public.handoffs(id,organization_id,role_id,created_by,service_period) values('e0000000-0000-4000-8000-000000000004','e0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000003','e0000000-0000-4000-8000-000000000001','2026–2027');
insert into public.sources(id,organization_id,handoff_id,created_by,kind,title,text_content) values('e0000000-0000-4000-8000-000000000005','e0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000004','e0000000-0000-4000-8000-000000000001','typed_text','Legacy notes','Preserve these private notes.');
insert into public.knowledge_items(id,organization_id,handoff_id,created_by,knowledge_type,title,content,status,origin) values('e0000000-0000-4000-8000-000000000006','e0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000004','e0000000-0000-4000-8000-000000000001','process','Legacy process','Meet the advisor in September.','approved','manual');
insert into public.organization_subscriptions(organization_id,purchaser_user_id,revenuecat_app_user_id,entitlement_id,status)
values('e0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001','relay_pro','active');
insert into public.handoff_publications(id,organization_id,handoff_id,access_token,organization_name,role_title,service_period,published_by)
values('e0000000-0000-4000-8000-000000000007','e0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000004',repeat('e',64),'Legacy migration fixture','President','2026–2027','e0000000-0000-4000-8000-000000000001');
insert into public.handoff_publication_items(publication_id,organization_id,handoff_id,source_knowledge_item_id,knowledge_lineage_id,knowledge_type,title,content,sort_order)
select 'e0000000-0000-4000-8000-000000000007',organization_id,handoff_id,id,lineage_id,knowledge_type,title,content,sort_order from public.knowledge_items where id = 'e0000000-0000-4000-8000-000000000006';
