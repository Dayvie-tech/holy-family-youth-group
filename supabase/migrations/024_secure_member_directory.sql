-- Holy Family Youth Group
-- Migration 024: expose a carefully limited member directory.
-- This view runs with its owner's permissions to read approved profiles while
-- exposing only the fields explicitly selected below.

create or replace view public.member_directory
with (security_barrier = true, security_invoker = false)
as
select
  coalesce(nullif(btrim(p.display_name), ''), p.full_name) as display_name,
  ph.name as prayer_house,
  nullif(btrim(p.public_bio), '') as public_bio,
  coalesce((
    select array_agg(distinct a.office_name order by a.office_name)
    from public.appointments a
    where a.member_id = p.id
      and a.verification_status = 'verified'
      and (a.effective_from is null or a.effective_from <= current_date)
      and (a.effective_until is null or a.effective_until >= current_date)
  ), array[]::text[]) as leadership_roles
from public.profiles p
left join public.prayer_houses ph on ph.id = p.primary_prayer_house_id
where p.membership_status = 'approved'
  and (
    p.profile_visibility = 'public'
    or (
      p.profile_visibility = 'members'
      and auth.uid() is not null
      and exists (
        select 1 from public.profiles viewer
        where viewer.id = auth.uid()
          and viewer.membership_status = 'approved'
      )
    )
  );

revoke all on public.member_directory from public, anon, authenticated;
grant select on public.member_directory to anon, authenticated;
comment on view public.member_directory is
  'Limited directory fields for approved members. Public profiles are visible to everyone; members-only profiles require an approved signed-in member. Never add private contact or administrative fields.';
