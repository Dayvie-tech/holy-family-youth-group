import { supabase } from './auth-client.js';

const $ = (id) => document.getElementById(id);
const offices = ['Youth Chaplain', 'Youth Matron', 'Youth Patron', 'Parish Moderator'];

function message(text, type = 'info') {
  const element = $('super-admin-status');
  element.textContent = text;
  element.className = 'form-message ' + type;
  element.hidden = false;
}

async function loadManagement() {
  const status = $('super-admin-status');
  const grid = $('super-admin-offices');
  status.hidden = true;
  grid.innerHTML = '<div class="admin-empty">Loading Super Admin offices…</div>';

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const user = sessionData.session?.user;
  if (!user) {
    window.location.replace('login.html');
    return;
  }

  const { data: myAssignments, error: accessError } = await supabase
    .from('admin_assignments')
    .select('access_level')
    .eq('user_id', user.id)
    .eq('is_active', true);
  if (accessError) throw accessError;

  if (!myAssignments?.some((assignment) => assignment.access_level === 'super_admin')) {
    $('super-admin-check').textContent = 'You do not have Super Admin access to this page.';
    window.setTimeout(() => window.location.replace('admin-dashboard.html'), 1400);
    return;
  }

  const [assignmentResult, memberResult] = await Promise.all([
    supabase.from('admin_assignments')
      .select('id, user_id, super_admin_office, created_at')
      .eq('access_level', 'super_admin')
      .eq('is_active', true),
    supabase.from('profiles')
      .select('id, full_name, display_name')
      .eq('membership_status', 'approved')
      .order('full_name', { ascending: true })
  ]);

  if (assignmentResult.error) throw assignmentResult.error;
  if (memberResult.error) throw memberResult.error;

  const assignments = assignmentResult.data || [];
  const members = memberResult.data || [];
  const memberMap = new Map(members.map((member) => [member.id, member]));
  const activeOfficeCount = offices.filter((office) => assignments.some((item) => item.super_admin_office === office)).length;
  $('office-count').textContent = activeOfficeCount + ' / 4';
  $('super-admin-check').hidden = true;
  $('super-admin-page').hidden = false;

  grid.innerHTML = '';
  offices.forEach((office) => {
    const holders = assignments.filter((item) => item.super_admin_office === office);
    const card = document.createElement('article');
    card.className = 'super-admin-card';

    const heading = document.createElement('h2');
    heading.textContent = office;
    card.append(heading);

    if (holders.length) {
      holders.forEach((holder) => {
        const member = memberMap.get(holder.user_id);
        const holderBox = document.createElement('div');
        holderBox.className = 'office-holder';
        const holderName = document.createElement('strong');
        holderName.textContent = member?.display_name || member?.full_name || 'Member profile unavailable';
        const holderMeta = document.createElement('span');
        holderMeta.textContent = holders.length > 1 ? 'Active appointment · duplicate active records need review' : 'Current office holder';
        holderBox.append(holderName, holderMeta);
        card.append(holderBox);
      });
    } else {
      const vacant = document.createElement('div');
      vacant.className = 'office-holder office-vacant';
      vacant.textContent = 'This office is currently vacant.';
      card.append(vacant);
    }

    const form = document.createElement('div');
    form.className = 'office-assign';
    const label = document.createElement('label');
    label.textContent = 'Appoint an approved member';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Select approved member for ' + office);
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a member…';
    select.append(placeholder);

    members.forEach((member) => {
      const option = document.createElement('option');
      option.value = member.id;
      option.textContent = member.display_name || member.full_name || 'Unnamed member';
      select.append(option);
    });

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button';
    button.textContent = holders.length ? 'Transfer office' : 'Appoint office holder';
    button.disabled = true;
    select.addEventListener('change', () => { button.disabled = !select.value; });

    button.addEventListener('click', async () => {
      const selectedId = select.value;
      const selectedName = select.options[select.selectedIndex]?.textContent || 'the selected member';
      if (!selectedId) return;
      const confirmation = holders.length
        ? 'Transfer ' + office + ' to ' + selectedName + '? The current active appointment will be deactivated.'
        : 'Appoint ' + selectedName + ' as ' + office + '?';
      if (!window.confirm(confirmation)) return;

      button.disabled = true;
      button.textContent = 'Saving appointment…';
      try {
        const { error } = await supabase.rpc('assign_super_admin_office', {
          p_target_user_id: selectedId,
          p_office: office
        });
        if (error) throw error;
        message(office + ' has been updated successfully. The change is recorded in the activity log.', 'success');
        await loadManagement();
      } catch (error) {
        message(error.message || 'The appointment could not be saved.', 'error');
        button.disabled = false;
        button.textContent = holders.length ? 'Transfer office' : 'Appoint office holder';
      }
    });

    form.append(label, select, button);
    card.append(form);
    grid.append(card);
  });
}

async function signOut() {
  await supabase.auth.signOut();
  window.location.replace('index.html');
}

$('sign-out')?.addEventListener('click', signOut);
$('refresh-offices')?.addEventListener('click', () => {
  loadManagement().catch((error) => message(error.message || 'Unable to load office holders.', 'error'));
});

loadManagement().catch((error) => {
  $('super-admin-check').hidden = true;
  message(error.message || 'Unable to load Super Admin Management.', 'error');
  $('super-admin-page').hidden = false;
});
