import { supabase } from './auth-client.js';

const $ = id => document.getElementById(id);
const state = { user: null, albums: [], houses: [] };
function message(text, type = 'info') {
  const box = $('gallery-admin-message');
  box.textContent = text;
  box.className = 'form-message ' + type;
  box.hidden = false;
}
function clearMessage() { $('gallery-admin-message').hidden = true; }
function dateLabel(value) {
  return value ? new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeZone: 'Africa/Nairobi' }).format(new Date(value + 'T00:00:00')) : 'Date not specified';
}
function action(parent, label, handler, light = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = light ? 'button button-light' : 'button';
  button.textContent = label;
  button.addEventListener('click', handler);
  parent.append(button);
  return button;
}
async function privatePhotoUrl(path) {
  const result = await supabase.storage.from('gallery-media').createSignedUrl(path, 3600);
  if (result.error) throw result.error;
  return result.data.signedUrl;
}
async function saveAlbum(status) {
  clearMessage();
  const payload = {
    title: $('gallery-title').value.trim(),
    description: $('gallery-description').value.trim(),
    event_date: $('gallery-date').value || null,
    prayer_house_id: $('gallery-house').value ? Number($('gallery-house').value) : null,
    status,
    created_by: state.user.id
  };
  const { error } = await supabase.from('gallery_albums').insert(payload);
  if (error) { message(error.message || 'The album could not be saved.', 'error'); return; }
  $('gallery-album-form').reset();
  message(status === 'draft' ? 'Album saved as a private draft.' : 'Album submitted for review. Another administrator must approve and publish it.', 'success');
  await loadAlbums();
}
async function uploadPhotos(event) {
  event.preventDefault();
  clearMessage();
  const albumId = $('gallery-photo-album').value;
  const files = Array.from($('gallery-files').files || []);
  if (!albumId || !files.length) { message('Choose an unpublished album and at least one photograph.', 'error'); return; }
  const album = state.albums.find(item => item.id === albumId);
  if (!album || album.status === 'published') { message('Photos can only be added to an unpublished album.', 'error'); return; }
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  for (const file of files) {
    if (!allowed.includes(file.type)) { message('Only JPG, PNG and WebP photographs are allowed.', 'error'); return; }
    if (file.size > 8 * 1024 * 1024) { message(file.name + ' is larger than 8 MB.', 'error'); return; }
  }
  const button = $('gallery-upload');
  button.disabled = true;
  button.textContent = 'Uploading…';
  const uploaded = [];
  try {
    for (const file of files) {
      const safeName = file.name.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').slice(-80);
      const path = state.user.id + '/' + crypto.randomUUID() + '-' + safeName;
      const { error: storageError } = await supabase.storage.from('gallery-media').upload(path, file, { upsert: false, contentType: file.type });
      if (storageError) throw storageError;
      uploaded.push(path);
      const { error: rowError } = await supabase.from('gallery_photos').insert({
        album_id: albumId,
        storage_path: path,
        caption: $('gallery-caption').value.trim(),
        alt_text: $('gallery-alt').value.trim(),
        display_order: uploaded.length - 1,
        created_by: state.user.id
      });
      if (rowError) throw rowError;
    }
    $('gallery-photo-form').reset();
    message(uploaded.length + ' photograph' + (uploaded.length === 1 ? '' : 's') + ' uploaded successfully. They will appear when the album is published.', 'success');
    await loadAlbums();
  } catch (error) {
    message(error.message || 'Some photographs could not be uploaded. Please refresh and check the album.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Upload photographs';
  }
}
async function changeStatus(album, status) {
  clearMessage();
  const patch = { status };
  const now = new Date().toISOString();
  if (['approved', 'rejected'].includes(status)) {
    patch.reviewed_by = state.user.id;
    patch.reviewed_at = now;
    patch.published_at = null;
  } else if (status === 'published') {
    patch.published_at = now;
  } else if (status === 'draft') {
    patch.reviewed_by = null;
    patch.reviewed_at = null;
    patch.published_at = null;
  } else if (status === 'archived') {
    patch.published_at = null;
  }
  const { data, error } = await supabase.from('gallery_albums').update(patch).eq('id', album.id).select('id').maybeSingle();
  if (error) { message(error.message || 'Album status could not be updated.', 'error'); return; }
  if (!data) { message('This album could not be changed. A different authorised administrator may need to review it.', 'error'); return; }
  const labels = { approved: 'approved for publication', published: 'published', rejected: 'rejected', archived: 'archived', draft: 'returned to draft' };
  message('Album ' + (labels[status] || status) + '.', 'success');
  await loadAlbums();
}
async function removePhoto(photo) {
  if (!window.confirm('Remove this photograph from the album?')) return;
  const { error } = await supabase.from('gallery_photos').delete().eq('id', photo.id);
  if (error) { message(error.message || 'The photograph could not be removed.', 'error'); return; }
  const { error: storageError } = await supabase.storage.from('gallery-media').remove([photo.storage_path]);
  if (storageError) console.warn('Photo record removed but storage cleanup needs attention.', storageError);
  message('Photograph removed from the album.', 'success');
  await loadAlbums();
}
async function renderAlbum(album, photos, review = false) {
  const card = document.createElement('article');
  card.className = 'gallery-admin-card';
  const head = document.createElement('div');
  head.className = 'gallery-admin-card-head';
  const titleWrap = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = album.title;
  const meta = document.createElement('p');
  meta.className = 'gallery-admin-meta';
  const house = state.houses.find(item => item.id === album.prayer_house_id);
  meta.textContent = [dateLabel(album.event_date), house?.name || 'Parish-wide'].join(' · ');
  titleWrap.append(title, meta);
  const badge = document.createElement('span');
  badge.className = 'gallery-admin-status';
  badge.textContent = album.status;
  head.append(titleWrap, badge);
  card.append(head);
  if (album.description) {
    const description = document.createElement('p');
    description.className = 'gallery-admin-meta';
    description.textContent = album.description;
    card.append(description);
  }
  const actions = document.createElement('div');
  actions.className = 'gallery-admin-actions';
  if (review) {
    if (album.created_by === state.user.id) {
      const note = document.createElement('p');
      note.className = 'gallery-admin-meta';
      note.textContent = 'Another authorised administrator must review this album.';
      actions.append(note);
    } else if (album.status === 'pending') {
      action(actions, 'Approve', () => changeStatus(album, 'approved'));
      action(actions, 'Reject', () => changeStatus(album, 'rejected'), true);
    } else if (album.status === 'approved') {
      action(actions, 'Publish', () => changeStatus(album, 'published'));
      action(actions, 'Reject', () => changeStatus(album, 'rejected'), true);
    }
  }
  if (album.status !== 'archived') action(actions, 'Archive', () => changeStatus(album, 'archived'), true);
  if (album.status === 'archived') action(actions, 'Restore to draft', () => changeStatus(album, 'draft'), true);
  card.append(actions);
  if (photos.length) {
    const grid = document.createElement('div');
    grid.className = 'gallery-admin-photo-grid';
    photos.forEach(photo => {
      const item = document.createElement('div');
      item.className = 'gallery-admin-photo';
      const img = document.createElement('img');
      img.src = await privatePhotoUrl(photo.storage_path);
      img.alt = photo.alt_text;
      const caption = document.createElement('p');
      caption.className = 'gallery-admin-meta';
      caption.textContent = photo.caption || photo.alt_text;
      item.append(img, caption);
      if (album.status !== 'published') action(item, 'Remove photo', () => removePhoto(photo), true);
      grid.append(item);
    });
    card.append(grid);
  } else {
    const note = document.createElement('p');
    note.className = 'gallery-admin-meta';
    note.textContent = 'No photographs have been added to this album yet.';
    card.append(note);
  }
  return card;
}
async function loadAlbums() {
  const [albumsResult, photosResult] = await Promise.all([
    supabase.from('gallery_albums').select('*').order('updated_at', { ascending: false }).limit(150),
    supabase.from('gallery_photos').select('*').order('display_order').order('created_at')
  ]);
  if (albumsResult.error) throw albumsResult.error;
  if (photosResult.error) throw photosResult.error;
  state.albums = albumsResult.data || [];
  const photos = new Map();
  (photosResult.data || []).forEach(photo => {
    if (!photos.has(photo.album_id)) photos.set(photo.album_id, []);
    photos.get(photo.album_id).push(photo);
  });
  const select = $('gallery-photo-album');
  const current = select.value;
  select.replaceChildren();
  const uploadable = state.albums.filter(album => album.status !== 'published' && album.status !== 'archived');
  if (!uploadable.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Create an unpublished album first';
    select.append(option);
  } else {
    uploadable.forEach(album => {
      const option = document.createElement('option');
      option.value = album.id;
      option.textContent = album.title + ' · ' + album.status;
      select.append(option);
    });
    if (uploadable.some(album => album.id === current)) select.value = current;
  }
  const all = $('gallery-all-list');
  const queue = $('gallery-review-list');
  all.replaceChildren();
  queue.replaceChildren();
  const allCards = await Promise.all(state.albums.map(album => renderAlbum(album, photos.get(album.id) || [])));
  allCards.forEach(card => all.append(card));
  const reviewAlbums = state.albums.filter(album => ['pending', 'approved'].includes(album.status));
  const reviewCards = await Promise.all(reviewAlbums.map(album => renderAlbum(album, photos.get(album.id) || [], true)));
  reviewCards.forEach(card => queue.append(card));
  if (!state.albums.length) all.innerHTML = '<div class="gallery-empty-admin">No albums have been created yet.</div>';
  if (!state.albums.some(album => ['pending', 'approved'].includes(album.status))) queue.innerHTML = '<div class="gallery-empty-admin">No albums are waiting for review.</div>';
}
async function initialize() {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    state.user = sessionData.session?.user;
    if (!state.user) { window.location.replace('login.html'); return; }
    const { data: assignments, error } = await supabase.from('admin_assignments').select('access_level').eq('user_id', state.user.id).eq('is_active', true);
    if (error) throw error;
    if (!assignments?.some(item => ['parish_admin', 'super_admin'].includes(item.access_level))) {
      $('gallery-access').textContent = 'This workspace is available only to authorised parish administrators.';
      return;
    }
    $('gallery-access').hidden = true;
    $('gallery-admin').hidden = false;
    const houses = await supabase.from('prayer_houses').select('id,name').order('name');
    if (houses.error) throw houses.error;
    state.houses = houses.data || [];
    state.houses.forEach(house => {
      const option = document.createElement('option');
      option.value = house.id;
      option.textContent = house.name;
      $('gallery-house').append(option);
    });
    await loadAlbums();
  } catch (error) {
    $('gallery-access').textContent = error.message || 'The gallery workspace could not be opened.';
  }
}
$('gallery-album-form').addEventListener('submit', event => { event.preventDefault(); saveAlbum('pending'); });
$('gallery-save-draft').addEventListener('click', () => {
  if (!$('gallery-album-form').reportValidity()) return;
  saveAlbum('draft');
});
$('gallery-photo-form').addEventListener('submit', uploadPhotos);
$('gallery-refresh').addEventListener('click', () => loadAlbums().catch(error => message(error.message, 'error')));
$('gallery-sign-out').addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.replace('login.html');
});
initialize();
