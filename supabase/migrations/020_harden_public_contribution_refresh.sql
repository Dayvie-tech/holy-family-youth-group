create or replace function private.refresh_prayer_house_contribution_public_total()
returns trigger language plpgsql security definer set search_path='' as $$
declare affected_house_id smallint;
begin
 if tg_table_name='prayer_house_contribution_targets' then
  if tg_op='DELETE' then
   affected_house_id:=old.prayer_house_id;
   update public.prayer_house_contribution_public_totals set target_amount=0,updated_at=now() where prayer_house_id=affected_house_id;
   return old;
  end if;
  affected_house_id:=new.prayer_house_id;
  update public.prayer_house_contribution_public_totals set target_amount=new.target_amount,updated_at=now() where prayer_house_id=affected_house_id;
  return new;
 end if;
 if tg_op='DELETE' or tg_op='UPDATE' then
  affected_house_id:=old.prayer_house_id;
  update public.prayer_house_contribution_public_totals set total_contributed=(select coalesce(sum(c.amount),0) from public.prayer_house_contributions c where c.prayer_house_id=affected_house_id),updated_at=now() where prayer_house_id=affected_house_id;
 end if;
 if tg_op='INSERT' or tg_op='UPDATE' then
  affected_house_id:=new.prayer_house_id;
  update public.prayer_house_contribution_public_totals set total_contributed=(select coalesce(sum(c.amount),0) from public.prayer_house_contributions c where c.prayer_house_id=affected_house_id),updated_at=now() where prayer_house_id=affected_house_id;
  return new;
 end if;
 return old;
end;$$;
revoke all on function private.refresh_prayer_house_contribution_public_total() from public,anon,authenticated;
