alter table public.profiles
  add column if not exists chaplain_title text
  check (chaplain_title is null or chaplain_title in ('Father', 'Deacon'));

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_name text;
  v_phone text;
  v_house_id smallint;
  v_scope text;
  v_office text;
  v_valid_office boolean := false;
  v_patron_claim jsonb;
  v_claim_scope text;
  v_claim_office text;
  v_gender text;
  v_chaplain_title text;
begin
  v_name := nullif(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
  if v_name is null then
    v_name := coalesce(nullif(pg_catalog.split_part(coalesce(new.email, ''), '@', 1), ''), 'New member');
  end if;
  v_phone := nullif(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '');
  v_gender := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'gender', ''))), '');
  if v_gender not in ('male', 'female') then v_gender := null; end if;
  v_chaplain_title := nullif(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'chaplain_title', '')), '');

  if coalesce(new.raw_user_meta_data ->> 'prayer_house_id', '') ~ '^[1-8]$' then
    select ph.id into v_house_id from public.prayer_houses ph
    where ph.id = (new.raw_user_meta_data ->> 'prayer_house_id')::smallint and ph.is_active = true;
  end if;

  if new.raw_user_meta_data ->> 'chaplain_claim' = 'parish' then
    if v_gender is distinct from 'male' then
      raise exception 'The Parish Chaplain appointment is reserved for male members.';
    end if;
    if v_chaplain_title not in ('Father', 'Deacon') then
      raise exception 'A Parish Chaplain applicant must select Father or Deacon as their Church title.';
    end if;
  else
    v_chaplain_title := null;
  end if;

  insert into public.profiles (
    id, full_name, primary_prayer_house_id, phone_private, membership_status, gender, chaplain_title
  ) values (new.id, v_name, v_house_id, v_phone, 'pending', v_gender, v_chaplain_title);

  v_scope := new.raw_user_meta_data ->> 'claim_scope';
  v_office := nullif(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'claim_office', '')), '');
  if v_office is not null and v_scope in ('parish', 'prayer_house') then
    if v_scope = 'parish' then
      v_valid_office := v_office in ('Moderator', 'Vice Moderator', 'Secretary', 'Vice Secretary',
        'Treasurer', 'Organizing Secretary', 'Project Manager', 'Assistant Project Manager',
        'Games Coordinator', 'Catechist');
      if v_valid_office then
        insert into public.appointments (member_id, office_name, scope, prayer_house_id)
        values (new.id, v_office, 'parish', null);
      end if;
    elsif v_scope = 'prayer_house' and v_house_id is not null then
      v_valid_office := v_office in ('Chairperson', 'Vice Chairperson', 'Secretary', 'Vice Secretary',
        'Treasurer', 'Organizing Secretary', 'Project Manager', 'Assistant Project Manager',
        'Games Coordinator', 'Catechist');
      if v_valid_office then
        insert into public.appointments (member_id, office_name, scope, prayer_house_id)
        values (new.id, v_office, 'prayer_house', v_house_id);
      end if;
    end if;
  end if;

  if pg_catalog.jsonb_typeof(new.raw_user_meta_data -> 'patron_matron_claims') = 'array' then
    for v_patron_claim in select value from pg_catalog.jsonb_array_elements(new.raw_user_meta_data -> 'patron_matron_claims')
    loop
      v_claim_scope := v_patron_claim ->> 'scope';
      v_claim_office := nullif(pg_catalog.btrim(coalesce(v_patron_claim ->> 'office_name', '')), '');
      if v_claim_office in ('Patron', 'Matron') then
        if v_claim_scope = 'parish' then
          insert into public.appointments (member_id, office_name, scope, prayer_house_id)
          values (new.id, v_claim_office, 'parish', null);
        elsif v_claim_scope = 'prayer_house' and v_house_id is not null then
          insert into public.appointments (member_id, office_name, scope, prayer_house_id)
          values (new.id, v_claim_office, 'prayer_house', v_house_id);
        end if;
      end if;
    end loop;
  end if;

  if new.raw_user_meta_data ->> 'chaplain_claim' = 'parish' then
    insert into public.appointments (member_id, office_name, scope, prayer_house_id)
    values (new.id, 'Chaplain', 'parish', null);
  end if;
  return new;
end;
$function$;

revoke all on function private.handle_new_auth_user() from public, anon, authenticated;
