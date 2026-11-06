-- Applied to Supabase project thhfvrlpywmgmlpondnj on 2026-11-07.
-- Holy Family Youth Group: audited membership review actions.
-- See the SQL comments and database/SECURITY-MODEL.md for access boundaries.

create table if not exists public.admin_activity_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles(id),
  action text not null,
  target_user_id uuid references public.profiles(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_activity_log enable row level security;
drop policy if exists admin_activity_log_super_admin_read on public.admin_activity_log;
create policy admin_activity_log_super_admin_read on public.admin_activity_log
  for select to authenticated using ((select private.is_super_admin()));
grant select on public.admin_activity_log to authenticated;

create or replace function public.review_membership(target_member_id uuid, decision text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_house_id smallint;
  v_current_status text;
begin
  if v_actor is null then raise exception 'You must be signed in to review membership applications.'; end if;
  if decision <> 'approve' then raise exception 'Unsupported review decision.'; end if;
  select p.primary_prayer_house_id, p.membership_status into v_house_id, v_current_status
  from public.profiles p where p.id = target_member_id for update;
  if not found then raise exception 'Membership application not found.'; end if;
  if not (private.has_parish_admin_access() or
    (v_house_id is not null and private.is_house_admin(v_house_id))) then
    raise exception 'You are not authorised to review this membership application.';
  end if;
  if v_current_status <> 'pending' then raise exception 'Only pending applications can be approved.'; end if;
  update public.profiles set membership_status='approved', updated_at=pg_catalog.now()
  where id=target_member_id;
  insert into public.admin_activity_log(actor_id,action,target_user_id,details)
  values(v_actor,'membership_approved',target_member_id,
    pg_catalog.jsonb_build_object('prayer_house_id',v_house_id));
end;
$$;
revoke all on function public.review_membership(uuid,text) from public, anon;
grant execute on function public.review_membership(uuid,text) to authenticated;
comment on table public.admin_activity_log is 'Restricted audit trail for administrative actions in the Holy Family Youth Group portal.';
