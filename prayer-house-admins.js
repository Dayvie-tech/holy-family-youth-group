import { supabase } from './auth-client.js';

const $ = (id) => document.getElementById(id);
const page = $('house-admin-page');
const loading = $('house-admin-loading');
const status = $('house-admin-status');
const houseList = $('house-admin-list');
const form = $('house-admin-form');
const houseSelect = $('house-admin-house');
const memberSelect = $('house-admin-member');
const saveButton = $('save-house-admin');

function showStatus(message, type = 'info') {
  status.textContent = message;
  status.className = `form-message ${type}`;
  status.hidden = false;
}

async function loadHouseAdministrators() {
  houseList.innerHTML = '<div class="admin-empty">Loading the eight prayer houses…</div>';
  const [housesResult, membersResult, assignmentsResult] = await Promise.all([
    supabase.from('prayer_houses').select('id, name').eq('is_active', true).order('id'),
    supabase.from('profiles').select('id, full_name').eq('membership_status', 'approved').order('full_name'),
    supabase.from('admin_assignments').select('id, user_id, prayer_house_id').eq('access_level', 'prayer_house_admin').eq('is_active', true)
  ]);

  if (housesResult.error) throw housesResult.error;
  if (membersResult.error) throw membersResult.error;
  if (assignmentsResult.error) throw assignmentsResult.error;

  const houses = housesResult.data || [];
  const members = membersResult.data || [];
  const holders = new Map((assignmentsResult.data || []).map((item) => [item.prayer_house_id, item.user_id]));
  const names = new Map(members.map((member) => [member.id, member.full_name]));

  houseList.replaceChildren();
  houses.forEach((house) => {
    const card = document.createElement('article');
    card.className = 'house-admin-card';
    const heading = document.createElement('h2');
    heading.textContent = house.name;
    const holder = document.createElement('p');
    holder.className = 'house-admin-holder';
    const holderId = holders.get(house.id);
    const label = document.createElement('strong');
    label.textContent = holderId ? (names.get(holderId) || 'Assigned member') : 'Vacant';
    holder.append('Administrator: ', label);
    card.append(heading, holder);
    const assignment = (assignmentsResult.data || []).find((item) => item.prayer_house_id === house.id && item.is_active !== false);
    if (assignment) {
      const actions = document.createElement('div');
      actions.className = 'house-admin-actions';
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'button button-light';
      removeButton.textContent = 'Remove administrator';
      removeButton.addEventListener('click', () => removeHouseAdministrator(assignment.id, house.name, names.get(assignment.user_id) || 'this administrator'));
      actions.append(removeButton);
      card.append(actions);
    }
    houseList.append(card);
  });

  houseSelect.replaceChildren();
  const housePlaceholder = document.createElement('option');
  housePlaceholder.value = '';
  housePlaceholder.textContent = 'Choose a prayer house';
  houseSelect.append(housePlaceholder);
  houses.forEach((house) => {
    const option = document.createElement('option');
    option.value = String(house.id);
    option.textContent = house.name;
    houseSelect.append(option);
  });

  memberSelect.replaceChildren();
  const memberPlaceholder = document.createElement('option');
  memberPlaceholder.value = '';
  memberPlaceholder.textContent = members.length ? 'Choose an approved member' : 'No approved members available';
  memberSelect.append(memberPlaceholder);
  members.forEach((member) => {
    const option = document.createElement('option');
    option.value = member.id;
    option.textContent = member.full_name;
    memberSelect.append(option);
  });
}

async function removeHouseAdministrator(assignmentId, houseName, administratorName) {
  const confirmed = window.confirm(
    `Remove ${administratorName} as administrator of ${houseName}? Their youth membership will remain active, but their administrator access to this house will be revoked.`
  );
  if (!confirmed) return;

  const buttons = houseList.querySelectorAll('button');
  buttons.forEach((button) => { button.disabled = true; });
  showStatus('Removing the prayer-house administrator…', 'info');
  try {
    const { error } = await supabase.rpc('remove_prayer_house_admin', {
      p_assignment_id: assignmentId
    });
    if (error) throw error;
    showStatus(`Administrator access for ${administratorName} at ${houseName} has been removed. The prayer house is now vacant.`, 'success');
    await loadHouseAdministrators();
  } catch (error) {
    showStatus(error.message || 'The administrator could not be removed.', 'error');
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
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
    if (profile?.membership_status !== 'approved') {
      window.location.replace('pending.html');
      return;
    }

    const { data: assignments, error: assignmentError } = await supabase
      .from('admin_assignments')
      .select('access_level')
      .eq('user_id', user.id)
      .eq('access_level', 'super_admin')
      .eq('is_active', true);
    if (assignmentError) throw assignmentError;
    if (!assignments?.length) {
      window.location.replace('admin-dashboard.html');
      return;
    }

    await loadHouseAdministrators();
    loading.hidden = true;
    page.hidden = false;
  } catch (error) {
    loading.textContent = error.message || 'Unable to verify administrator access.';
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const houseId = Number(houseSelect.value);
  const memberId = memberSelect.value;
  if (!houseId || !memberId) return;

  saveButton.disabled = true;
  saveButton.textContent = 'Saving appointment…';
  status.hidden = true;
  try {
    const { error } = await supabase.rpc('assign_prayer_house_admin', {
      p_target_user_id: memberId,
      p_prayer_house_id: houseId
    });
    if (error) throw error;
    showStatus('Prayer-house administrator appointment saved successfully. Any previous holder has been transferred out of this house.', 'success');
    form.reset();
    await loadHouseAdministrators();
  } catch (error) {
    showStatus(error.message || 'The administrator appointment could not be saved.', 'error');
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = 'Save administrator appointment';
  }
});

$('sign-out')?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.replace('index.html');
});

initialize();
