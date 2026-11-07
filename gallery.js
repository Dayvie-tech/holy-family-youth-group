import { supabase } from './auth-client.js';

const root = document.getElementById('gallery-albums');
const status = document.getElementById('gallery-status');
const dateLabel = value => value
  ? new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeZone: 'Africa/Nairobi' }).format(new Date(value + 'T00:00:00'))
  : 'Date not recorded';

async function photoCard(photo) {
  const figure = document.createElement('figure');
  figure.className = 'gallery-photo';
  const image = document.createElement('img');
  image.loading = 'lazy';
  const signed = await supabase.storage.from('gallery-media').createSignedUrl(photo.storage_path, 3600);
  if (signed.error) throw signed.error;
  image.src = signed.data.signedUrl;
  image.alt = photo.alt_text;
  const caption = document.createElement('figcaption');
  caption.textContent = photo.caption || photo.alt_text;
  figure.append(image, caption);
  return figure;
}

async function albumCard(album, photos, houseName) {
  const card = document.createElement('article');
  card.className = 'gallery-album';
  const heading = document.createElement('div');
  heading.className = 'gallery-album-heading';
  const meta = document.createElement('p');
  meta.className = 'eyebrow blue';
  meta.textContent = [dateLabel(album.event_date), houseName].filter(Boolean).join(' · ');
  const title = document.createElement('h3');
  title.textContent = album.title;
  const description = document.createElement('p');
  description.className = 'gallery-album-description';
  description.textContent = album.description || 'A collection of moments from our parish youth community.';
  heading.append(meta, title, description);
  card.append(heading);
  const grid = document.createElement('div');
  grid.className = 'gallery-photo-grid';
  const photoCards = await Promise.all(photos.map(photoCard));
  photoCards.forEach(photo => grid.append(photo));
  if (photos.length) card.append(grid);
  return card;
}

async function loadGallery() {
  try {
    const [albumsResult, photosResult, housesResult] = await Promise.all([
      supabase.from('published_gallery_albums').select('id,title,description,event_date,prayer_house_id,created_at').order('event_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }),
      supabase.from('published_gallery_photos').select('id,album_id,storage_path,caption,alt_text,display_order,created_at').order('display_order').order('created_at'),
      supabase.from('prayer_houses').select('id,name')
    ]);
    if (albumsResult.error) throw albumsResult.error;
    if (photosResult.error) throw photosResult.error;
    const houses = new Map((housesResult.data || []).map(house => [house.id, house.name]));
    const photos = new Map();
    (photosResult.data || []).forEach(photo => {
      if (!photos.has(photo.album_id)) photos.set(photo.album_id, []);
      photos.get(photo.album_id).push(photo);
    });
    root.replaceChildren();
    const cards = await Promise.all((albumsResult.data || []).map(album => albumCard(album, photos.get(album.id) || [], houses.get(album.prayer_house_id) || '')));
    cards.forEach(card => root.append(card));
    if (!albumsResult.data?.length) {
      root.innerHTML = '<div class="gallery-empty">Our public photo archive is ready. Approved albums will appear here as they are published.</div>';
      status.textContent = 'No public albums have been published yet.';
    } else {
      status.textContent = albumsResult.data.length + ' published album' + (albumsResult.data.length === 1 ? '' : 's') + ' in our gallery.';
    }
  } catch (error) {
    console.error('Gallery loading failed', error);
    status.textContent = 'The gallery could not be loaded right now. Please refresh the page.';
    root.innerHTML = '<div class="gallery-empty">Please try again in a moment.</div>';
  }
}
loadGallery();
