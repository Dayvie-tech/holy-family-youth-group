-- Applied to Supabase project thhfvrlpywmgmlpondnj on 2026-11-07.
-- Restricts approval to one profile status transition through column grants + RLS.
drop function if exists public.review_membership(uuid, text);

drop policy if exists profiles_admin_approve_pending on public.profiles;
create policy profiles_admin_approve_pending on public.profiles for update to authenticated
using (
  membership_status='pending'
  and ((select private.has_parish_admin_access()) or
    (primary_prayer_house_id is not null and (select private.is_house_admin(primary_prayer_house_id))))
)
with check (
  membership_status='approved'
  and ((select private.has_parish_admin_access()) or
    (primary_prayer_house_id is not null and (select private.is_house_admin(primary_prayer_house_id))))
);
grant update (membership_status, updated_at) on public.profiles to authenticated;

create or replace function private.log_membership_approval()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_actor uuid := auth.uid();
begin
  if old.membership_status='pending' and new.membership_status='approved' then
    if v_actor is null then raise exception 'Membership approval must be performed by an authenticated administrator.'; end if;
    insert into public.admin_activity_log(actor_id,action,target_user_id,details)
    values(v_actor,'membership_approved',new.id,
      pg_catalog.jsonb_build_object('prayer_house_id',new.primary_prayer_house_id));
  end if;
  return new;
end;
$$;
revoke all on function private.log_membership_approval() from public,anon,authenticated;
drop trigger if exists on_membership_approved_audit on public.profiles;
create trigger on_membership_approved_audit after update of membership_status on public.profiles
for each row execute function private.log_membership_approval();
