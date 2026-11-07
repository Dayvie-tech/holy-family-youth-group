create table if not exists public.prayer_house_contribution_targets (
  prayer_house_id smallint primary key references public.prayer_houses(id) on delete restrict,
  target_amount numeric(12,2) not null default 0 check (target_amount >= 0),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists public.prayer_house_contributions (
  id uuid primary key default gen_random_uuid(),
  prayer_house_id smallint not null references public.prayer_houses(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  contribution_date date not null default current_date,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists prayer_house_contributions_house_date_idx on public.prayer_house_contributions (prayer_house_id, contribution_date desc);
insert into public.prayer_house_contribution_targets (prayer_house_id) select id from public.prayer_houses where is_active=true on conflict (prayer_house_id) do nothing;
alter table public.prayer_house_contribution_targets enable row level security;
alter table public.prayer_house_contributions enable row level security;
grant select, update on public.prayer_house_contribution_targets to authenticated;
grant select, insert, update, delete on public.prayer_house_contributions to authenticated;
create policy "Contribution targets are visible to authorised house admins" on public.prayer_house_contribution_targets for select to authenticated using ((select private.is_house_admin(prayer_house_id)));
create policy "Parish administrators manage contribution targets" on public.prayer_house_contribution_targets for update to authenticated using ((select private.has_parish_admin_access())) with check ((select private.has_parish_admin_access()));
create policy "Authorised house administrators view contribution entries" on public.prayer_house_contributions for select to authenticated using ((select private.is_house_admin(prayer_house_id)));
create policy "Authorised house administrators record house contributions" on public.prayer_house_contributions for insert to authenticated with check ((select private.is_house_admin(prayer_house_id)));
create policy "Parish administrators correct contribution entries" on public.prayer_house_contributions for update to authenticated using ((select private.has_parish_admin_access())) with check ((select private.has_parish_admin_access()));
create policy "Parish administrators remove contribution entries" on public.prayer_house_contributions for delete to authenticated using ((select private.has_parish_admin_access()));
create table if not exists private.prayer_house_contribution_audit (
 id bigint generated always as identity primary key, table_name text not null, record_id uuid,
 action text not null check (action in ('INSERT','UPDATE','DELETE')), actor_id uuid, old_data jsonb, new_data jsonb, changed_at timestamptz not null default now()
);
alter table private.prayer_house_contribution_audit enable row level security;
revoke all on private.prayer_house_contribution_audit from public,anon,authenticated;
revoke all on sequence private.prayer_house_contribution_audit_id_seq from public,anon,authenticated;
create or replace function private.audit_prayer_house_contribution_change() returns trigger language plpgsql security definer set search_path='' as $$
declare old_json jsonb; new_json jsonb; record_uuid uuid;
begin
 if tg_op='DELETE' then old_json:=to_jsonb(old);record_uuid:=(old_json->>'id')::uuid;
 else new_json:=to_jsonb(new);if tg_op='UPDATE' then old_json:=to_jsonb(old);end if;
  if tg_table_name='prayer_house_contribution_targets' then record_uuid:=null;else record_uuid:=(new_json->>'id')::uuid;end if;
 end if;
 insert into private.prayer_house_contribution_audit(table_name,record_id,action,actor_id,old_data,new_data) values(tg_table_name,record_uuid,tg_op,auth.uid(),old_json,new_json);
 if tg_op='DELETE' then return old;end if;return new;
end;$$;
create or replace function private.prepare_prayer_house_contribution() returns trigger language plpgsql set search_path='' as $$
begin if tg_op='INSERT' then new.created_by:=auth.uid();new.created_at:=now();else new.created_by:=old.created_by;new.created_at:=old.created_at;end if;new.updated_at:=now();return new;end;$$;
create or replace function private.prepare_prayer_house_contribution_target() returns trigger language plpgsql set search_path='' as $$
begin new.updated_by:=auth.uid();new.updated_at:=now();return new;end;$$;
drop trigger if exists prayer_house_contributions_prepare on public.prayer_house_contributions;
create trigger prayer_house_contributions_prepare before insert or update on public.prayer_house_contributions for each row execute function private.prepare_prayer_house_contribution();
drop trigger if exists prayer_house_contributions_audit on public.prayer_house_contributions;
create trigger prayer_house_contributions_audit after insert or update or delete on public.prayer_house_contributions for each row execute function private.audit_prayer_house_contribution_change();
drop trigger if exists prayer_house_contribution_targets_prepare on public.prayer_house_contribution_targets;
create trigger prayer_house_contribution_targets_prepare before insert or update on public.prayer_house_contribution_targets for each row execute function private.prepare_prayer_house_contribution_target();
drop trigger if exists prayer_house_contribution_targets_audit on public.prayer_house_contribution_targets;
create trigger prayer_house_contribution_targets_audit after insert or update or delete on public.prayer_house_contribution_targets for each row execute function private.audit_prayer_house_contribution_change();
create or replace function public.get_public_prayer_house_contribution_progress() returns table(prayer_house_id smallint,prayer_house_name text,target_amount numeric,total_contributed numeric,remaining_balance numeric)
language sql stable security definer set search_path='' as $$
 select h.id,h.name,coalesce(t.target_amount,0)::numeric,coalesce(sum(c.amount),0)::numeric,greatest(coalesce(t.target_amount,0)-coalesce(sum(c.amount),0),0)::numeric
 from public.prayer_houses h left join public.prayer_house_contribution_targets t on t.prayer_house_id=h.id
 left join public.prayer_house_contributions c on c.prayer_house_id=h.id where h.is_active=true group by h.id,h.name,t.target_amount order by h.id;
$$;
revoke all on function public.get_public_prayer_house_contribution_progress() from public;
grant execute on function public.get_public_prayer_house_contribution_progress() to anon,authenticated;
revoke all on function private.audit_prayer_house_contribution_change() from public,anon,authenticated;
revoke all on function private.prepare_prayer_house_contribution() from public,anon,authenticated;
revoke all on function private.prepare_prayer_house_contribution_target() from public,anon,authenticated;
