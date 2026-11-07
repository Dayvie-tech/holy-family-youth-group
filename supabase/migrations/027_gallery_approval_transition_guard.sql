-- Enforce the gallery's two-person review workflow at database level.
-- The UI is not a security boundary: direct API updates must obey the same transitions.
create or replace function private.guard_gallery_album_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'The original album creator cannot be changed.';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'pending' then
      if new.reviewed_by is not null or new.reviewed_at is not null or new.published_at is not null then
        raise exception 'A submitted album cannot carry review or publication details.';
      end if;
    elsif old.status = 'pending' and new.status in ('approved','rejected') then
      if auth.uid() is null or auth.uid() = old.created_by
         or new.reviewed_by is distinct from auth.uid()
         or new.reviewed_at is null
         or new.published_at is not null then
        raise exception 'A different authorised administrator must review the submitted album.';
      end if;
    elsif old.status = 'approved' and new.status = 'published' then
      if old.reviewed_by is null or old.reviewed_by = old.created_by
         or new.reviewed_by is distinct from old.reviewed_by
         or new.reviewed_at is distinct from old.reviewed_at
         or new.published_at is null then
        raise exception 'Only an album approved by a different administrator can be published.';
      end if;
    elsif old.status = 'approved' and new.status = 'rejected' then
      if auth.uid() is null or auth.uid() = old.created_by then
        raise exception 'The album creator cannot reject their own album.';
      end if;
    elsif old.status in ('draft','pending','approved','published','rejected') and new.status = 'archived' then
      if new.published_at is not null then
        raise exception 'Archived albums cannot remain marked as published.';
      end if;
    elsif old.status in ('rejected','archived') and new.status = 'draft' then
      if new.reviewed_by is not null or new.reviewed_at is not null or new.published_at is not null then
        raise exception 'A returned draft must clear its previous review and publication details.';
      end if;
    else
      raise exception 'Invalid gallery album status transition: % to %.', old.status, new.status;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function private.guard_gallery_album_status_transition() from public, anon, authenticated;

drop trigger if exists gallery_albums_guard_status_transition on public.gallery_albums;
create trigger gallery_albums_guard_status_transition
before update on public.gallery_albums
for each row execute function private.guard_gallery_album_status_transition();
