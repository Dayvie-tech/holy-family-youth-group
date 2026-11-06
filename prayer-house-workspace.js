import { supabase } from './auth-client.js';

const $ = (id) => document.getElementById(id);
const page = $('house-workspace');
const loading = $('house-workspace-loading');
const houseList = $('assigned-house-list');
const status = $('workspace-status');
const count = $('assigned-house-count');

function showStatus(message, type = 'info') {
  status.textContent = message;
  status.className = `form-message ${type}`;
  status.hidden = false;
}

function makeLeadershipRow(office, name) {
  const row = document.createElement('div');
  row.className = 'leadership-row';
  const officeName = document.createElement('strong');
  officeName.textContent = office;
  const memberName = document.createElement('span');
  memberName.textContent = name || 'Name unavailable';
  row.append(officeName, memberName);
  return row;
}

async function loadWorkspace(user) {
  status.hidden = true;
  houseList.innerHTML = '<div class="admin-empty">Loading your assigned prayer houses…</div>';

  const { data: assignments, error: assignmentError } = await supabase
    .from('admin_assignments')
    .select('prayer_house_id')
    .eq('user_id', user.id)
    .eq('access_level', 'prayer_house_admin')
    .eq('is_active', true);
  if (assignmentError) throw assignmentError;

  const houseIds = [...new Set((assignments || []).map((item) => item.prayer_house_id).filter(Boolean))];
  if (!houseIds.length) {
    window.location.replace('admin-dashboard.html');
    return;
  }

  const [{ data: houses, error: housesError }, { data: profile, error: profileError }] = await Promise.all([
    supabase.from('prayer_houses').select('id, name').in('id', houseIds).eq('is_active', true).order('id'),
    supabase.from('profiles').select('full_name').eq('id', user.id).single()
  ]);
  if (housesError) throw housesError;
  if (profileError) throw profileError;

  $('workspace-admin-name').textContent = profile.full_name || 'Administrator';
  count.textContent = String(houses?.length || 0);
  houseList.replaceChildren();

  for (const house of houses || []) {
    const card = document.createElement('article');
    card.className = 'assigned-house-card';

    const heading = document.createElement('div');
    heading.className = 'assigned-house-heading';
    const title = document.createElement('h3');
    title.textContent = house.name;
    const tag = document.createElement('span');
    tag.className = 'house-admin-tag';
    tag.textContent = 'Assigned house';
    heading.append(title, tag);

    const roster = document.createElement('div');
    roster.className = 'leadership-list';
    const { data: leaders, error: leadersError } = await supabase
      .from('appointments')
      .select('office_name, member_display_name, effective_from, effective_until')
      .eq('scope', 'prayer_house')
      .eq('prayer_house_id', house.id)
      .eq('verification_status', 'verified')
      .order('office_name');
    if (leadersError) throw leadersError;

    const now = new Date();
    const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
    const activeLeaders = (leaders || []).filter((leader) =>
      (!leader.effective_from || leader.effective_from <= today) &&
      (!leader.effective_until || leader.effective_until >= today)
    );

    if (!activeLeaders.length) {
      const empty = document.createElement('div');
      empty.className = 'leadership-empty';
      empty.textContent = 'No verified leadership appointments are currently recorded for this prayer house.';
      roster.append(empty);
    } else {
      activeLeaders.forEach((leader) => roster.append(makeLeadershipRow(leader.office_name, leader.member_display_name)));
    }

    card.append(heading, roster);
    houseList.append(card);
  }

  if (!houses?.length) {
    houseList.innerHTML = '<div class="admin-empty">No active assigned prayer houses were found. Please contact a Super Administrator.</div>';
  }
}

async function initialize() {
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const user = sessionData.session?.user;
    if (!user) {
      window.location.replace('login.html');
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('membership_status')
      .eq('id', user.id)
      .single();
    if (profileError) throw profileError;
    if (profile.membership_status !== 'approved') {
      window.location.replace('pending.html');
      return;
    }

    const { data: assignments, error: assignmentError } = await supabase
      .from('admin_assignments')
      .select('access_level')
      .eq('user_id', user.id)
      .eq('is_active', true);
    if (assignmentError) throw assignmentError;
    if (!assignments?.some((item) => item.access_level === 'prayer_house_admin')) {
      window.location.replace(assignments?.length ? 'admin-dashboard.html' : 'member-dashboard.html');
      return;
    }

    await loadWorkspace(user);
    loading.hidden = true;
    page.hidden = false;
  } catch (error) {
    loading.textContent = error.message || 'Unable to load your prayer-house workspace.';
  }
}

$('refresh-house-workspace')?.addEventListener('click', async () => {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user) {
    window.location.replace('login.html');
    return;
  }
  try {
    await loadWorkspace(data.session.user);
    showStatus('Prayer-house workspace refreshed.', 'success');
  } catch (error) {
    showStatus(error.message || 'The workspace could not be refreshed.', 'error');
  }
});

$('sign-out')?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.replace('index.html');
});

initialize();
