import { supabase } from './auth-client.js';

const $ = (id) => document.getElementById(id);
const dateFormat = new Intl.DateTimeFormat('en-KE', { dateStyle: 'full', timeStyle: 'short' });

async function getHouseNames() {
  const { data, error } = await supabase.from('prayer_houses').select('id, name').eq('is_active', true);
  if (error) throw error;
  return new Map((data || []).map((house) => [house.id, house.name]));
}

function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function audienceLabel(item, houses) {
  return item.scope === 'parish' ? 'Parish-wide' : (houses.get(item.prayer_house_id) || 'Prayer house');
}

function showEmpty(container, text) {
  container.replaceChildren(make('div', 'content-feed-empty', text));
}

async function loadAnnouncements() {
  const feed = $('announcements-feed');
  if (!feed) return;
  try {
    const [{ data, error }, houses] = await Promise.all([
      supabase.from('announcements')
        .select('id, title, body, scope, prayer_house_id, is_pinned, expires_at, published_at')
        .eq('status', 'published')
        .order('is_pinned', { ascending: false })
        .order('published_at', { ascending: false }),
      getHouseNames()
    ]);
    if (error) throw error;
    const now = Date.now();
    const active = (data || []).filter((item) => !item.expires_at || new Date(item.expires_at).getTime() > now);
    feed.replaceChildren();
    for (const item of active) {
      const card = make('article', 'content-feed-card');
      const header = make('div', 'content-feed-card-heading');
      header.append(make('span', 'content-feed-audience', audienceLabel(item, houses)));
      if (item.is_pinned) header.append(make('span', 'content-feed-pinned', 'Pinned'));
      card.append(header);
      card.append(make('h2', 'content-feed-title', item.title));
      card.append(make('p', 'content-feed-body', item.body));
      card.append(make('p', 'content-feed-date', `Published ${dateFormat.format(new Date(item.published_at))}`));
      feed.append(card);
    }
    if (!active.length) showEmpty(feed, 'There are no current announcements to display. Please check again soon.');
  } catch (error) {
    showEmpty(feed, error.message || 'Announcements could not be loaded. Please refresh the page.');
  }
}

function countdownText(startAt) {
  const diff = new Date(startAt).getTime() - Date.now();
  if (diff <= 0) return 'Event has started';
  const minutes = Math.floor(diff / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;
  if (days) return `Starts in ${days}d ${hours}h`;
  if (hours) return `Starts in ${hours}h ${remainingMinutes}m`;
  return `Starts in ${Math.max(1, remainingMinutes)}m`;
}

async function loadEvents() {
  const upcomingFeed = $('upcoming-events-feed');
  const archiveFeed = $('past-events-feed');
  if (!upcomingFeed || !archiveFeed) return;
  try {
    const [{ data, error }, houses] = await Promise.all([
      supabase.from('events')
        .select('id, title, description, scope, prayer_house_id, starts_at, ends_at, venue, poster_path, published_at')
        .eq('status', 'published')
        .order('starts_at', { ascending: true }),
      getHouseNames()
    ]);
    if (error) throw error;
    const now = Date.now();
    const upcoming = [];
    const past = [];
    for (const item of data || []) {
      const finish = item.ends_at ? new Date(item.ends_at).getTime() : new Date(item.starts_at).getTime();
      (finish < now ? past : upcoming).push(item);
    }

    upcomingFeed.replaceChildren();
    archiveFeed.replaceChildren();
    for (const item of upcoming) {
      const card = make('article', 'content-feed-card event-feed-card');
      if (item.poster_path) {
        const poster = make('img', 'event-feed-poster');
        poster.src = supabase.storage.from('community-posters').getPublicUrl(item.poster_path).data.publicUrl;
        poster.alt = `Poster for ${item.title}`;
        poster.loading = 'lazy';
        card.append(poster);
      }
      card.append(make('span', 'content-feed-audience', audienceLabel(item, houses)));
      card.append(make('h2', 'content-feed-title', item.title));
      card.append(make('p', 'content-feed-date', dateFormat.format(new Date(item.starts_at))));
      card.append(make('p', 'content-feed-venue', `Venue: ${item.venue}`));
      card.append(make('p', 'content-feed-body', item.description));
      const countdown = make('p', 'event-countdown', countdownText(item.starts_at));
      card.append(countdown);
      upcomingFeed.append(card);
      countdown.dataset.startsAt = item.starts_at;
    }
    for (const item of past.reverse()) {
      const card = make('article', 'content-feed-card event-archive-card');
      card.append(make('span', 'content-feed-audience', audienceLabel(item, houses)));
      card.append(make('h3', 'content-feed-title', item.title));
      card.append(make('p', 'content-feed-date', dateFormat.format(new Date(item.starts_at))));
      card.append(make('p', 'content-feed-venue', `Venue: ${item.venue}`));
      archiveFeed.append(card);
    }
    if (!upcoming.length) showEmpty(upcomingFeed, 'No upcoming events have been published yet.');
    if (!past.length) showEmpty(archiveFeed, 'Past events will appear here after they finish.');
  } catch (error) {
    showEmpty(upcomingFeed, error.message || 'Events could not be loaded.');
    showEmpty(archiveFeed, 'The event archive is temporarily unavailable.');
  }
}

function updateCountdowns() {
  document.querySelectorAll('.event-countdown[data-starts-at]').forEach((node) => {
    node.textContent = countdownText(node.dataset.startsAt);
  });
}

if ($('announcements-feed')) loadAnnouncements();
if ($('upcoming-events-feed')) {
  loadEvents();
  window.setInterval(updateCountdowns, 60000);
}
