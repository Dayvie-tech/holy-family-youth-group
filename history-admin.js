import { supabase } from './auth-client.js';

const $ = id => document.getElementById(id);
const state = { user: null };
const categories = {
  'beginnings': 'Our beginnings',
  'faith-fellowship': 'Faith & fellowship',
  'leadership-service': 'Leadership & service',
  'projects-milestones': 'Projects & milestones',
  'photo-memories': 'Photo memories'
};

function showMessage(message, type = 'info') {
  const box = $('heritage-admin-message');
  box.textContent = message;
  box.className = 'form-message ' + type;
  box.hidden = false;
}
function clearMessage() { $('heritage-admin-message').hidden = true; }
function dateLabel(value) {
  if (!value) return 'Date not specified';
  return new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeZone: 'Africa/Nairobi' }).format(new Date(value + 'T00:00:00'));
}
function publicPhoto(path) {
  return path ? supabase.storage.from('heritage-media').getPublicUrl(path).data.publicUrl : '';
}
function resetForm() {
  $('heritage-entry-form').reset();
  $('heritage-entry-id').value = '';
  $('heritage-editor-title').textContent = 'Add a history record';
  $('heritage-cancel-edit').hidden = true;
}
function beginEdit(entry) {
  $('heritage-entry-id').value = entry.id;
  $('heritage-title').value = entry.title;
  $('heritage-category').value = entry.category;
  $('heritage-date').value = entry.event_date || '';
  $('heritage-body').value = entry.body;
  $('heritage-caption').value = entry.photo_caption || '';
  $('heritage-remove-photo').checked = false;
  $('heritage-photo').value = '';
  $('heritage-editor-title').textContent = 'Edit history record';
  $('heritage-cancel-edit').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function addAction(parent, label, callback, style = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = ('button ' + style).trim();
  button.textContent = label;
  button.addEventListener('click', callback);
  parent.append(button);
  return button;
}
function renderRecord(entry, review = false) {
  const card = document.createElement('article');
  card.className = 'heritage-record';
  const top = document.createElement('div');
  top.className = 'heritage-record-top';
  const titleWrap = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = entry.title;
  const meta = document.createElement('p');
  meta.className = 'heritage-meta';
  meta.textContent = (categories[entry.category] || entry.category) + ' · ' + dateLabel(entry.event_date);
  titleWrap.append(title, meta);
  const status = document.createElement('span');
  status.className = 'heritage-status';
  status.textContent = entry.status;
  top.append(titleWrap, status);
  const body = document.createElement('p');
  body.textContent = entry.body;
  card.append(top, body);
  if (entry.photo_path) {
    const img = document.createElement('img');
    img.className = 'heritage-record-photo';
    img.src = publicPhoto(entry.photo_path);
    img.alt = entry.photo_caption || entry.title;
    card.append(img);
    if (entry.photo_caption) {
      const caption = document.createElement('p');
      caption.className = 'heritage-meta';
      caption.textContent = entry.photo_caption;
      card.append(caption);
    }
  }
  const actions = document.createElement('div');
  actions.className = 'heritage-record-actions';
  if (review) {
    if (entry.created_by !== state.user.id) {
      addAction(actions, 'Publish', () => updateStatus(entry, 'published'));
    } else {
      const note = document.createElement('span');
      note.className = 'heritage-meta';
      note.textContent = 'Another administrator must review your submission.';
      actions.append(note);
    }
    addAction(actions, 'Reject', () => updateStatus(entry, 'rejected'), 'button-light');
  }
  addAction(actions, 'Edit', () => beginEdit(entry), 'button-light');
  if (entry.status !== 'archived') addAction(actions, 'Archive', () => updateStatus(entry, 'archived'), 'button-light');
  if (entry.status === 'archived') addAction(actions, 'Restore to draft', () => updateStatus(entry, 'draft'), 'button-light');
  card.append(actions);
  return card;
}
async function updateStatus(entry, status) {
  clearMessage();
  const isDecision = status === 'published' || status === 'rejected';
  const patch = {
    status,
    reviewed_by: isDecision ? state.user.id : null,
    reviewed_at: isDecision ? new Date().toISOString() : null,
    published_at: status === 'published' ? new Date().toISOString() : null
  };
  const { error } = await supabase.from('heritage_entries').update(patch).eq('id', entry.id);
  if (error) { showMessage(error.message, 'error'); return; }
  showMessage(status === 'published' ? 'History record published successfully.' : 'Record moved to ' + status.replaceAll('_', ' ') + '.', 'success');
  await loadEntries();
}
async function uploadPhoto(file) {
  if (!file) return null;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG or WebP image.');
  if (file.size > 8 * 1024 * 1024) throw new Error('The image must be 8 MB or smaller.');
  const safe = file.name.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').slice(-80);
  const path = state.user.id + '/' + crypto.randomUUID() + '-' + safe;
  const { error } = await supabase.storage.from('heritage-media').upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  return path;
}
async function saveEntry(status) {
  clearMessage();
  const id = $('heritage-entry-id').value;
  const payload = {
    title: $('heritage-title').value.trim(),
    category: $('heritage-category').value,
    event_date: $('heritage-date').value || null,
    body: $('heritage-body').value.trim(),
    photo_caption: $('heritage-caption').value.trim() || null,
    status
  };
  const file = $('heritage-photo').files && $('heritage-photo').files[0];
  if (file) payload.photo_path = await uploadPhoto(file);
  if ($('heritage-remove-photo').checked) payload.photo_path = null;
  if (id) {
    const { error } = await supabase.from('heritage_entries').update(payload).eq('id', id);
    if (error) throw error;
    showMessage('History record updated. If it was previously published, it must be reviewed again before returning to the public archive.', 'success');
  } else {
    payload.created_by = state.user.id;
    const { error } = await supabase.from('heritage_entries').insert(payload);
    if (error) throw error;
    showMessage(status === 'draft' ? 'Draft saved privately.' : 'Record submitted for another administrator to review.', 'success');
  }
  resetForm();
  await loadEntries();
}
async function loadEntries() {
  const results = await Promise.all([
    supabase.from('heritage_entries').select('*').order('updated_at', { ascending: false }).limit(150),
    supabase.from('heritage_entries').select('*').eq('status', 'pending').order('created_at', { ascending: true }).limit(100)
  ]);
  if (results[0].error) throw results[0].error;
  if (results[1].error) throw results[1].error;
  const all = $('heritage-all-list');
  const queue = $('heritage-review-list');
  all.replaceChildren();
  queue.replaceChildren();
  (results[0].data || []).forEach(entry => all.append(renderRecord(entry)));
  (results[1].data || []).forEach(entry => queue.append(renderRecord(entry, true)));
  if (!results[0].data || !results[0].data.length) all.textContent = 'No history records have been created yet.';
  if (!results[1].data || !results[1].data.length) queue.textContent = 'No records are waiting for review.';
}
async function initialize() {
  try {
    const { data } = await supabase.auth.getSession();
    state.user = data.session && data.session.user;
    if (!state.user) { window.location.replace('login.html'); return; }
    const profileResult = await supabase.from('profiles').select('membership_status').eq('id', state.user.id).single();
    if (profileResult.error) throw profileResult.error;
    if (profileResult.data.membership_status !== 'approved') { window.location.replace('pending.html'); return; }
    const assignmentResult = await supabase.from('admin_assignments').select('access_level').eq('user_id', state.user.id).eq('is_active', true);
    if (assignmentResult.error) throw assignmentResult.error;
    const authorised = (assignmentResult.data || []).some(item => ['parish_admin', 'super_admin'].includes(item.access_level));
    if (!authorised) { window.location.replace('member-dashboard.html'); return; }
    $('heritage-access').hidden = true;
    $('heritage-admin').hidden = false;
    await loadEntries();
  } catch (error) {
    $('heritage-access').textContent = error.message || 'Unable to verify administrator access.';
    $('heritage-access').className = 'form-message error';
  }
}
$('heritage-entry-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await saveEntry('pending'); } catch (error) { showMessage(error.message || 'Could not submit this record.', 'error'); }
});
$('heritage-save-draft').addEventListener('click', async () => {
  try { await saveEntry('draft'); } catch (error) { showMessage(error.message || 'Could not save this draft.', 'error'); }
});
$('heritage-cancel-edit').addEventListener('click', resetForm);
$('heritage-refresh').addEventListener('click', async () => {
  try { await loadEntries(); showMessage('History records refreshed.', 'success'); } catch (error) { showMessage(error.message, 'error'); }
});
$('heritage-sign-out').addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.replace('login.html');
});
initialize();
