import { supabase } from './auth-client.js';

const $ = (id) => document.getElementById(id);
const state = { user: null, houses: [], houseAdminIds: [], parishAccess: false };
const statusBox = $('content-form-status');
const scopeSelect = $('content-scope');
const houseField = $('content-house-field');
const houseSelect = $('content-house');
const typeSelect = $('content-type');
const eventFields = $('event-fields');
const announcementFields = $('announcement-fields');

function message(target, text, type = 'info') {
  target.textContent = text;
  target.className = `form-message ${type}`;
  target.hidden = false;
}

function clearMessage(target) {
  target.hidden = true;
  target.textContent = '';
}

function addText(parent, tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = value ?? '';
  parent.append(el);
  return el;
}

function canManageHouse(houseId) {
  return state.parishAccess || state.houseAdminIds.includes(Number(houseId));
}

function refreshScopeFields() {
  const parish = scopeSelect.value === 'parish';
  houseField.hidden = parish;
  houseSelect.required = !parish;
}

function refreshTypeFields() {
  const isEvent = typeSelect.value === 'event';
  eventFields.hidden = !isEvent;
  announcementFields.hidden = isEvent;
  $('content-body-label').firstChild.textContent = isEvent ? 'Event description' : 'Message';
  $('event-starts').required = isEvent;
  $('event-venue').required = isEvent;
}

function populateHouses() {
  houseSelect.replaceChildren();
  for (const house of state.houses) {
    const option = document.createElement('option');
    option.value = String(house.id);
    option.textContent = house.name;
    houseSelect.append(option);
  }
  if (!state.parishAccess) {
    const parishOption = [...scopeSelect.options].find((option) => option.value === 'parish');
    if (parishOption) parishOption.remove();
    scopeSelect.value = 'prayer_house';
  }
  refreshScopeFields();
}

function formatDate(value) {
  if (!value) return 'Date not set';
  return new Intl.DateTimeFormat('en-KE', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function contentCard(item, type, options = {}) {
  const card = document.createElement('article');
  card.className = 'content-record-card';
  const top = document.createElement('div');
  top.className = 'content-record-top';
  const title = addText(top, 'h3', '', item.title);
  title.className = 'content-record-title';
  addText(top, 'span', `content-status status-${item.status}`, item.status.replaceAll('_', ' '));
  card.append(top);
  addText(card, 'p', 'content-record-kind', type === 'event' ? 'EVENT' : 'ANNOUNCEMENT');
  addText(card, 'p', 'content-record-summary', item.description || item.body);
  const house = state.houses.find((entry) => entry.id === item.prayer_house_id);
  const audience = item.scope === 'parish' ? 'Whole parish' : (house?.name || 'Prayer house');
  addText(card, 'p', 'content-record-meta', `${audience} · ${type === 'event' ? formatDate(item.starts_at) : formatDate(item.created_at)}`);
  if (type === 'event') addText(card, 'p', 'content-record-meta', `Venue: ${item.venue}`);

  if (options.review) {
    const actions = document.createElement('div');
    actions.className = 'content-record-actions';
    const approve = document.createElement('button');
    approve.type = 'button';
    approve.className = 'button';
    approve.textContent = 'Approve';
    approve.addEventListener('click', () => reviewContent(type, item.id, 'approved', approve));
    const reject = document.createElement('button');
    reject.type = 'button';
    reject.className = 'button button-light';
    reject.textContent = 'Reject';
    reject.addEventListener('click', () => reviewContent(type, item.id, 'rejected', reject));
    actions.append(approve, reject);
    card.append(actions);
  }

  if (options.publish) {
    const actions = document.createElement('div');
    actions.className = 'content-record-actions';
    const publish = document.createElement('button');
    publish.type = 'button';
    publish.className = 'button';
    publish.textContent = 'Publish now';
    publish.addEventListener('click', () => publishContent(type, item.id, publish));
    actions.append(publish);
    card.append(actions);
  }
  return card;
}

async function reviewContent(type, id, decision, button) {
  button.disabled = true;
  const table = type === 'event' ? 'events' : 'announcements';
  const { error } = await supabase.from(table).update({
    status: decision,
    reviewer_id: state.user.id,
    reviewed_at: new Date().toISOString()
  }).eq('id', id).eq('status', 'pending_approval');
  if (error) {
    button.disabled = false;
    alert(`Could not ${decision} this submission: ${error.message}`);
    return;
  }
  await loadContent();
}

async function publishContent(type, id, button) {
  button.disabled = true;
  const table = type === 'event' ? 'events' : 'announcements';
  const { error } = await supabase.from(table).update({
    status: 'published',
    published_by: state.user.id,
    published_at: new Date().toISOString()
  }).eq('id', id).eq('status', 'approved');
  if (error) {
    button.disabled = false;
    alert(`Could not publish this item: ${error.message}`);
    return;
  }
  await loadContent();
}

async function loadContent() {
  const queue = $('review-queue');
  const own = $('own-content-list');
  queue.replaceChildren();
  own.replaceChildren();

  const [announcementsResult, eventsResult] = await Promise.all([
    supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(100),
    supabase.from('events').select('*').order('created_at', { ascending: false }).limit(100)
  ]);
  if (announcementsResult.error) throw announcementsResult.error;
  if (eventsResult.error) throw eventsResult.error;

  const announcements = announcementsResult.data || [];
  const events = eventsResult.data || [];
  const pending = [
    ...announcements.filter((item) => item.status === 'pending_approval').map((item) => ({ item, type: 'announcement' })),
    ...events.filter((item) => item.status === 'pending_approval').map((item) => ({ item, type: 'event' }))
  ].sort((a, b) => new Date(a.item.created_at) - new Date(b.item.created_at));
  const approved = [
    ...announcements.filter((item) => item.status === 'approved').map((item) => ({ item, type: 'announcement' })),
    ...events.filter((item) => item.status === 'approved').map((item) => ({ item, type: 'event' }))
  ].sort((a, b) => new Date(a.item.created_at) - new Date(b.item.created_at));

  if (state.parishAccess) {
    for (const entry of pending) queue.append(contentCard(entry.item, entry.type, { review: true }));
    for (const entry of approved) queue.append(contentCard(entry.item, entry.type, { publish: true }));
    $('review-queue-description').textContent = 'Review pending submissions and publish approved items. Approval and publication are separate decisions.';
    if (!pending.length && !approved.length) addText(queue, 'div', 'admin-empty', 'No items are waiting for review or publication.');
  } else {
    $('review-queue-description').textContent = 'Your submissions are listed below. Parish leadership handles approval and publication.';
    addText(queue, 'div', 'admin-empty', 'You do not have parish-wide review permissions.');
  }

  const visible = [
    ...announcements.map((item) => ({ item, type: 'announcement' })),
    ...events.map((item) => ({ item, type: 'event' }))
  ].sort((a, b) => new Date(b.item.created_at) - new Date(a.item.created_at));
  for (const entry of visible) own.append(contentCard(entry.item, entry.type));
  if (!visible.length) addText(own, 'div', 'admin-empty', 'No content has been created yet.');
}

async function uploadPoster(file) {
  if (!file) return null;
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) throw new Error('Choose a JPG, PNG or WebP poster.');
  if (file.size > 5 * 1024 * 1024) throw new Error('The poster must be 5 MB or smaller.');
  const safeName = file.name.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').slice(-90);
  const path = `${state.user.id}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from('community-posters').upload(path, file, {
    upsert: false,
    contentType: file.type
  });
  if (error) throw error;
  return path;
}

async function saveContent(targetStatus) {
  clearMessage(statusBox);
  const type = typeSelect.value;
  const scope = scopeSelect.value;
  const houseId = scope === 'prayer_house' ? Number(houseSelect.value) : null;
  if (scope === 'prayer_house' && !canManageHouse(houseId)) {
    throw new Error('You are not authorised to publish for that prayer house.');
  }
  if (scope === 'parish' && !state.parishAccess) {
    throw new Error('Only parish-level administrators can create parish-wide content.');
  }

  const title = $('content-title').value.trim();
  const body = $('content-body').value.trim();
  const common = {
    title,
    scope,
    prayer_house_id: houseId,
    author_id: state.user.id,
    status: 'draft'
  };
  let table;
  let record;
  if (type === 'announcement') {
    table = 'announcements';
    record = {
      ...common,
      body,
      is_pinned: $('announcement-pinned').checked,
      expires_at: $('announcement-expires').value ? new Date($('announcement-expires').value).toISOString() : null
    };
  } else {
    const starts = $('event-starts').value;
    if (!starts) throw new Error('Choose the event date and start time.');
    record = {
      ...common,
      description: body,
      starts_at: new Date(starts).toISOString(),
      ends_at: $('event-ends').value ? new Date($('event-ends').value).toISOString() : null,
      venue: $('event-venue').value.trim(),
      poster_path: null
    };
    if (record.ends_at && record.ends_at < record.starts_at) throw new Error('The event end time must be after its start time.');
    table = 'events';
  }

  const { data: created, error: insertError } = await supabase.from(table).insert(record).select('id').single();
  if (insertError) throw insertError;

  if (type === 'event' && $('event-poster').files?.[0]) {
    const path = await uploadPoster($('event-poster').files[0]);
    const { error: posterError } = await supabase.from(table).update({ poster_path: path }).eq('id', created.id);
    if (posterError) throw posterError;
  }

  if (targetStatus === 'pending_approval') {
    const { error: submitError } = await supabase.from(table).update({ status: 'pending_approval' }).eq('id', created.id);
    if (submitError) throw submitError;
  }

  $('content-create-form').reset();
  refreshTypeFields();
  refreshScopeFields();
  message(statusBox, targetStatus === 'draft'
    ? 'Draft saved. It is not visible to members.'
    : 'Submitted successfully. It is now waiting for parish review.', 'success');
  await loadContent();
}

async function initialize() {
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    state.user = sessionData.session?.user;
    if (!state.user) {
      window.location.replace('login.html');
      return;
    }
    const [{ data: profile, error: profileError }, { data: assignments, error: assignmentError }, { data: houses, error: housesError }] = await Promise.all([
      supabase.from('profiles').select('membership_status').eq('id', state.user.id).single(),
      supabase.from('admin_assignments').select('access_level, prayer_house_id').eq('user_id', state.user.id).eq('is_active', true),
      supabase.from('prayer_houses').select('id, name').eq('is_active', true).order('id')
    ]);
    if (profileError) throw profileError;
    if (assignmentError) throw assignmentError;
    if (housesError) throw housesError;
    if (profile.membership_status !== 'approved') {
      window.location.replace('pending.html');
      return;
    }

    state.parishAccess = (assignments || []).some((item) => ['parish_admin', 'super_admin'].includes(item.access_level));
    state.houseAdminIds = [...new Set((assignments || [])
      .filter((item) => item.access_level === 'prayer_house_admin')
      .map((item) => Number(item.prayer_house_id)))];
    if (!state.parishAccess && !state.houseAdminIds.length) {
      window.location.replace('member-dashboard.html');
      return;
    }
    state.houses = (houses || []).filter((house) => state.parishAccess || state.houseAdminIds.includes(Number(house.id)));
    populateHouses();
    $('content-access-check').hidden = true;
    $('content-manager').hidden = false;
    if (!state.parishAccess) {
      $('review-queue-title').textContent = 'Parish approval';
    }
    await loadContent();
  } catch (error) {
    message($('content-access-check'), error.message || 'Unable to load the content workspace.', 'error');
  }
}

scopeSelect.addEventListener('change', refreshScopeFields);
typeSelect.addEventListener('change', refreshTypeFields);
$('content-create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try { await saveContent('pending_approval'); }
  catch (error) { message(statusBox, error.message || 'Could not submit this content.', 'error'); }
});
document.querySelectorAll('[data-save-status="draft"]').forEach((button) => {
  button.addEventListener('click', async () => {
    try { await saveContent('draft'); }
    catch (error) { message(statusBox, error.message || 'Could not save this draft.', 'error'); }
  });
});
$('refresh-content').addEventListener('click', async () => {
  try { await loadContent(); message(statusBox, 'Content refreshed.', 'success'); }
  catch (error) { message(statusBox, error.message || 'Could not refresh content.', 'error'); }
});
$('content-sign-out').addEventListener('click', async () => {
  const { error } = await supabase.auth.signOut();
  if (error) message($('content-access-check'), error.message, 'error');
  else window.location.replace('login.html');
});

refreshTypeFields();
initialize();
