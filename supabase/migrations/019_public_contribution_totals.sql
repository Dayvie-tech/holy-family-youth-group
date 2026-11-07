create table if not exists public.prayer_house_contribution_public_totals (
 prayer_house_id smallint primary key references public.prayer_houses(id) on delete restrict,
 prayer_house_name text not null,
 target_amount numeric(12,2) not null default 0 check(target_amount>=0),
 total_contributed numeric(14,2) not null default 0 check(total_contributed>=0),
 remaining_balance numeric(14,2) generated always as (greatest(target_amount-total_contributed,0)) stored,
 updated_at timestamptz not null default now()
);
insert into public.prayer_house_contribution_public_totals(prayer_house_id,prayer_house_name,target_amount,total_contributed)
select h.id,h.name,coalesce(t.target_amount,0),coalesce(sum(c.amount),0)
from public.prayer_houses h left join public.prayer_house_contribution_targets t on t.prayer_house_id=h.id
left join public.prayer_house_contributions c on c.prayer_house_id=h.id where h.is_active=true
group by h.id,h.name,t.target_amount
on conflict(prayer_house_id) do update set prayer_house_name=excluded.prayer_house_name,target_amount=excluded.target_amount,total_contributed=excluded.total_contributed,updated_at=now();
alter table public.prayer_house_contribution_public_totals enable row level security;
grant select on public.prayer_house_contribution_public_totals to anon,authenticated;
create policy "Collective prayer-house totals are public" on public.prayer_house_contribution_public_totals for select to anon,authenticated using(true);
create index if not exists prayer_house_contributions_created_by_idx on public.prayer_house_contributions(created_by);
create index if not exists prayer_house_contribution_targets_updated_by_idx on public.prayer_house_contribution_targets(updated_by);
create or replace function private.refresh_prayer_house_contribution_public_total() returns trigger language plpgsql security definer set search_path='' as $$
declare affected_house_id smallint;
begin
 if tg_table_name='prayer_house_contribution_targets' then
  if tg_op='DELETE' then affected_house_id:=old.prayer_house_id;update public.prayer_house_contribution_public_totals set target_amount=0,updated_at=now() where prayer_house_id=affected_house_id;return old;end if;
  affected_house_id:=new.prayer_house_id;update public.prayer_house_contribution_public_totals set target_amount=new.target_amount,updated_at=now() where prayer_house_id=affected_house_id;return new;
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
drop trigger if exists prayer_house_contribution_targets_public_total on public.prayer_house_contribution_targets;
create trigger prayer_house_contribution_targets_public_total after insert or update or delete on public.prayer_house_contribution_targets for each row execute function private.refresh_prayer_house_contribution_public_total();
drop trigger if exists prayer_house_contributions_public_total on public.prayer_house_contributions;
create trigger prayer_house_contributions_public_total after insert or update or delete on public.prayer_house_contributions for each row execute function private.refresh_prayer_house_contribution_public_total();
revoke all on function private.refresh_prayer_house_contribution_public_total() from public,anon,authenticated;
drop function if exists public.get_public_prayer_house_contribution_progress();
