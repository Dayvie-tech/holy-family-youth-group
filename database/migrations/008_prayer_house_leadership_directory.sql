-- Migration 008: safe, role-scoped prayer-house leadership directory.
-- Initial RPC implementation. Migration 009 replaces this with a safer
-- RLS-scoped appointment display-name snapshot to avoid exposed definer RPCs.

create or replace function public.get_house_leadership(p_prayer_house_id smallint)
returns table (
  office_name text,
  member_name text,
  display_name text,
  effective_from date,
  effective_until date
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  if not (
    private.is_house_admin(p_prayer_house_id)
    or private.has_parish_admin_access()
    or private.is_super_admin()
  ) then
    raise exception 'You are not authorised to view this prayer-house leadership directory.'
      using errcode = '42501';
  end if;

  return query
  select
    a.office_name,
    p.full_name,
    coalesce(nullif(p.display_name, ''), p.full_name),
    a.effective_from,
    a.effective_until
  from public.appointments as a
  join public.profiles as p on p.id = a.member_id
  where a.scope = 'prayer_house'
    and a.prayer_house_id = p_prayer_house_id
    and a.verification_status = 'verified'
    and (a.effective_from is null or a.effective_from <= current_date)
    and (a.effective_until is null or a.effective_until >= current_date)
  order by a.office_name, a.created_at;
end;
$function$;

revoke all on function public.get_house_leadership(smallint) from public, anon;
grant execute on function public.get_house_leadership(smallint) to authenticated;
