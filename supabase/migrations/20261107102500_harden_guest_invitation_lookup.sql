drop function if exists public.get_guest_virtual_meeting_invite(text);

alter table public.virtual_meeting_invitations
  drop constraint if exists virtual_meeting_guest_email_valid;

alter table public.virtual_meeting_invitations
  add constraint virtual_meeting_guest_email_valid
  check (
    guest_email is null
    or (
      position('@' in guest_email) > 1
      and position('.' in split_part(guest_email,'@',2)) > 1
      and guest_email !~ '[[:space:]]'
    )
  );
