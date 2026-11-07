-- Correct the swapped Gicherori and Kianguchu prayer-house names.
-- Keep the existing IDs and foreign-key relationships unchanged.
do $$
declare
  changed integer;
begin
  update public.prayer_houses
     set name = 'Our Lady of Visitation Gicherori'
   where id = 3
     and name = 'Our Lady of Assumption Gicherori';
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'Expected exactly one Gicherori prayer-house record to be renamed; updated %', changed;
  end if;

  update public.prayer_houses
     set name = 'Our Lady of Assumption Kianguchu'
   where id = 6
     and name = 'Our Lady of Visitation Kianguchu';
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'Expected exactly one Kianguchu prayer-house record to be renamed; updated %', changed;
  end if;

  update public.chat_rooms
     set name = 'Our Lady of Visitation Gicherori'
   where prayer_house_id = 3
     and name = 'Our Lady of Assumption Gicherori';
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'Expected exactly one Gicherori chat room to be renamed; updated %', changed;
  end if;

  update public.chat_rooms
     set name = 'Our Lady of Assumption Kianguchu'
   where prayer_house_id = 6
     and name = 'Our Lady of Visitation Kianguchu';
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'Expected exactly one Kianguchu chat room to be renamed; updated %', changed;
  end if;
end $$;
