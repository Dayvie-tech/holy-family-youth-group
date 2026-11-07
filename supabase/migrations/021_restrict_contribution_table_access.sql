revoke all on public.prayer_house_contribution_targets from anon;
revoke all on public.prayer_house_contributions from anon;
grant select, update on public.prayer_house_contribution_targets to authenticated;
grant select, insert, update, delete on public.prayer_house_contributions to authenticated;
