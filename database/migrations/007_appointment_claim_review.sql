-- Migration 007: secure review of leadership appointment claims.
-- House administrators may review only claims for their assigned house.
-- Parish administrators and Super Administrators may review parish-wide claims
-- and claims from any prayer house.

drop policy if exists appointments_admin_review_pending on public.appointments;
create policy appointments_admin_review_pending
  on public.appointments
  for update
  to authenticated
  using (
    verification_status = 'pending'
    and (
      (scope = 'parish' and private.has_parish_admin_access())
      or
      (scope = 'prayer_house' and private.is_house_admin(prayer_house_id))
    )
  )
  with check (
    verification_status in ('verified', 'rejected')
    and verified_by = (select auth.uid())
    and verified_at is not null
    and (
      (scope = 'parish' and private.has_parish_admin_access())
      or
      (scope = 'prayer_house' and private.is_house_admin(prayer_house_id))
    )
  );

-- Remove broad/default table grants, then restore only the required operations.
-- UPDATE is restricted to the three review fields; claimant and office details
-- cannot be changed by a browser client.
revoke all on public.appointments from public, anon, authenticated;
grant select, insert on public.appointments to authenticated;
grant update (verification_status, verified_by, verified_at)
  on public.appointments to authenticated;

create or replace function private.log_appointment_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Appointment review must be performed by an authenticated administrator.';
  end if;

  insert into public.admin_activity_log (
    actor_id,
    action,
    target_user_id,
    details
  )
  values (
    v_actor,
    case
      when new.verification_status = 'verified' then 'appointment_claim_verified'
      else 'appointment_claim_rejected'
    end,
    new.member_id,
    pg_catalog.jsonb_build_object(
      'appointment_id', new.id,
      'office_name', new.office_name,
      'scope', new.scope,
      'prayer_house_id', new.prayer_house_id,
      'verification_status', new.verification_status
    )
  );

  return new;
end;
$function$;

revoke all on function private.log_appointment_review() from public, anon, authenticated;

drop trigger if exists appointments_log_review on public.appointments;
create trigger appointments_log_review
  after update of verification_status on public.appointments
  for each row
  when (
    old.verification_status = 'pending'
    and new.verification_status in ('verified', 'rejected')
  )
  execute function private.log_appointment_review();
