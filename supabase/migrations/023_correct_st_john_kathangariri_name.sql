-- Correct the official name of prayer house ID 5 without changing its identity or member links.
-- Keeping the ID stable preserves profiles, administrator assignments, chat history,
-- events, announcements, and contribution records associated with this house.

update public.prayer_houses
set name = 'St. John Kathangariri',
    slug = 'st-john-kathangariri'
where id = 5;

update public.prayer_house_contribution_public_totals
set prayer_house_name = 'St. John Kathangariri',
    updated_at = now()
where prayer_house_id = 5;

update public.chat_rooms
set name = 'St. John Kathangariri'
where prayer_house_id = 5
  and room_type = 'prayer_house';
