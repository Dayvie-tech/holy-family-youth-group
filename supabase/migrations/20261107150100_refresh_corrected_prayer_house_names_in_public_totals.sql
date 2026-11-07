-- Keep the denormalised public contribution summary labels aligned with prayer_houses.
update public.prayer_house_contribution_public_totals
set prayer_house_name = case prayer_house_id
  when 3 then 'Our Lady of Visitation Gicherori'
  when 6 then 'Our Lady of Assumption Kianguchu'
  else prayer_house_name
end,
updated_at = now()
where prayer_house_id in (3, 6);
