import { supabase, authCallbackUrl } from './auth-client.js';

const $ = (id) => document.getElementById(id);
const showMessage = (element, message, type = 'info') => {
  if (!element) return;
  element.textContent = message;
  element.className = `form-message ${type}`;
  element.hidden = false;
};
const hideMessage = (element) => { if (element) element.hidden = true; };

async function membershipDestination(user) {
  const { data, error } = await supabase
    .from('profiles')
    .select('full_name, membership_status')
    .eq('id', user.id)
    .single();

  if (error || !data) {
    throw new Error('Your account was verified, but the member profile could not be loaded. Please contact the parish portal administrator.');
  }
  if (data.membership_status === 'approved') {
    const { data: assignments } = await supabase
      .from('admin_assignments')
      .select('access_level, prayer_house_id')
      .eq('user_id', user.id)
      .eq('is_active', true);
    if (assignments?.length) {
      const houseOnly = assignments.every((assignment) => assignment.access_level === 'prayer_house_admin');
      window.location.replace(houseOnly ? 'prayer-house-workspace.html' : 'admin-dashboard.html');
    } else {
      window.location.replace('member-dashboard.html');
    }
    return;
  }
  if (data.membership_status === 'suspended') {
    await supabase.auth.signOut();
    throw new Error('This membership is currently suspended. Please contact the parish portal administrator.');
  }
  window.location.replace('pending.html');
}

function setupRegistration() {
  const form = $('registration-form');
  if (!form) return;

  const scope = $('claim-scope');
  const office = $('claim-office');
  const house = $('prayer-house');
  const claimOptions = {
    prayer_house: ['Chairperson', 'Vice Chairperson', 'Secretary', 'Vice Secretary', 'Treasurer', 'Organizing Secretary', 'Project Manager', 'Assistant Project Manager', 'Games Coordinator', 'Catechist'],
    parish: ['Moderator', 'Vice Moderator', 'Secretary', 'Vice Secretary', 'Treasurer', 'Organizing Secretary', 'Project Manager', 'Assistant Project Manager', 'Games Coordinator', 'Catechist']
  };

  function refreshClaimFields() {
    const selectedScope = scope.value;
    office.innerHTML = '<option value="">Select an office (optional)</option>';
    (claimOptions[selectedScope] || []).forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      office.append(option);
    });
    office.disabled = !selectedScope;
    $('claim-note').textContent = selectedScope === 'parish'
      ? 'Parish office claims are submitted for verification by the authorized parish leadership.'
      : selectedScope === 'prayer_house'
        ? 'Prayer-house office claims will be linked to the prayer house selected above and must be verified.'
        : 'You can register as an ordinary member without claiming a leadership office.';
  }
  scope.addEventListener('change', refreshClaimFields);
  refreshClaimFields();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = $('registration-message');
    hideMessage(message);

    const fullName = $('full-name').value.trim();
    const email = $('email').value.trim().toLowerCase();
    const phone = $('phone').value.trim();
    const prayerHouseId = house.value;
    const password = $('password').value;
    const confirmPassword = $('confirm-password').value;
    const claimScope = scope.value;
    const claimOffice = office.value;

    if (password.length < 8) {
      showMessage(message, 'Use a password with at least 8 characters.', 'error');
      return;
    }
    if (password !== confirmPassword) {
      showMessage(message, 'The two passwords do not match.', 'error');
      return;
    }
    if (claimScope && !claimOffice) {
      showMessage(message, 'Choose the office you are claiming, or clear the claim type.', 'error');
      return;
    }

    const submit = $('register-submit');
    submit.disabled = true;
    submit.textContent = 'Submitting registration…';
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: authCallbackUrl(),
          data: {
            full_name: fullName,
            phone,
            prayer_house_id: prayerHouseId,
            claim_scope: claimScope || null,
            claim_office: claimOffice || null
          }
        }
      });
      if (error) throw error;

      if (data.session && data.user) {
        await membershipDestination(data.user);
        return;
      }
      showMessage(message, 'Registration received. We have sent a verification link to your email. Open that link to verify your address; your membership will then remain pending until an administrator approves it.', 'success');
      form.reset();
      refreshClaimFields();
    } catch (error) {
      showMessage(message, error.message || 'Registration could not be completed. Please try again.', 'error');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Create membership account';
    }
  });
}

function setupLogin() {
  const form = $('login-form');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = $('login-message');
    hideMessage(message);
    const submit = $('login-submit');
    submit.disabled = true;
    submit.textContent = 'Signing in…';
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: $('login-email').value.trim().toLowerCase(),
        password: $('login-password').value
      });
      if (error) throw error;
      await membershipDestination(data.user);
    } catch (error) {
      showMessage(message, error.message || 'Sign-in failed. Check your details and try again.', 'error');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Sign in';
    }
  });
}

async function setupCallback() {
  if (!$('callback-status')) return;
  const status = $('callback-status');
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!data.session?.user) {
      throw new Error('The confirmation link could not be completed. It may have expired or already been used. Return to sign in and request a new confirmation email if needed.');
    }
    status.textContent = 'Email verified. Checking your membership application…';
    await membershipDestination(data.session.user);
  } catch (error) {
    showMessage(status, error.message || 'Email confirmation failed.', 'error');
  }
}

async function setupProtectedPage() {
  const page = $('protected-page');
  if (!page) return;
  const status = $('access-check');
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session?.user) {
    window.location.replace('login.html');
    return;
  }
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('full_name, membership_status, primary_prayer_house_id')
      .eq('id', sessionData.session.user.id)
      .single();
    if (error || !profile) throw new Error('Member profile unavailable.');
    if (profile.membership_status === 'pending') {
      window.location.replace('pending.html');
      return;
    }
    if (profile.membership_status !== 'approved') {
      await supabase.auth.signOut();
      throw new Error('Your membership is not active. Please contact the parish portal administrator.');
    }
    $('member-name').textContent = profile.full_name;
    const { data: house } = await supabase
      .from('prayer_houses')
      .select('name')
      .eq('id', profile.primary_prayer_house_id)
      .maybeSingle();
    $('member-house').textContent = house?.name || 'Prayer house not set';
    page.hidden = false;
    if (status) status.hidden = true;
  } catch (error) {
    showMessage(status, error.message || 'Unable to load member access.', 'error');
  }
}

async function setupPendingPage() {
  const page = $('pending-page');
  if (!page) return;
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user) {
    window.location.replace('login.html');
    return;
  }
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('full_name, membership_status')
      .eq('id', data.session.user.id)
      .single();
    if (error || !profile) throw new Error('Your member profile is not available yet. Please contact the portal administrator.');
    if (profile.membership_status === 'approved') {
      await membershipDestination(data.session.user);
      return;
    }
    if (profile.membership_status === 'suspended') {
      await supabase.auth.signOut();
      window.location.replace('login.html');
      return;
    }
    $('pending-name').textContent = profile.full_name;
    page.hidden = false;
  } catch (error) {
    showMessage($('pending-message'), error.message, 'error');
  }
}

function setupSignOut() {
  const button = $('sign-out');
  if (!button) return;
  button.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.replace('index.html');
  });
}

setupRegistration();
setupLogin();
setupCallback();
setupProtectedPage();
setupPendingPage();
setupSignOut();


async function setupAdminDashboard() {
  const page = $('admin-page');
  if (!page) return;

  const status = $('admin-status');
  const list = $('application-list');
  const count = $('application-count');
  const reload = $('reload-applications');
  const claimList = $('appointment-claim-list');
  const claimStatus = $('appointment-claim-status');
  const claimCount = $('appointment-claim-count');

  const showAdminError = (message) => showMessage(status, message, 'error');

  const superAdminPanel = $('super-admin-panel');
  const superAdminStatus = $('super-admin-status');
  const officeList = $('super-admin-office-list');
  const assignmentForm = $('super-admin-assignment-form');
  const officeSelect = $('super-admin-office');
  const memberSelect = $('super-admin-member');
  const superAdminOffices = ['Youth Chaplain', 'Youth Matron', 'Youth Patron', 'Parish Moderator'];

  async function loadSuperAdminPanel() {
    if (!superAdminPanel) return;
    superAdminPanel.hidden = false;
    officeList.innerHTML = '<div class="admin-empty">Loading office holders…</div>';
    const [membersResult, assignmentsResult] = await Promise.all([
      supabase.from('profiles').select('id, full_name').eq('membership_status', 'approved').order('full_name'),
      supabase.from('admin_assignments').select('user_id, super_admin_office').eq('access_level', 'super_admin').eq('is_active', true)
    ]);
    if (membersResult.error) throw membersResult.error;
    if (assignmentsResult.error) throw assignmentsResult.error;
    const members = membersResult.data || [];
    const holders = new Map((assignmentsResult.data || []).map((item) => [item.super_admin_office, item.user_id]));
    const names = new Map(members.map((member) => [member.id, member.full_name]));
    officeList.replaceChildren();
    superAdminOffices.forEach((office) => {
      const card = document.createElement('article');
      card.className = 'super-admin-office-card';
      const title = document.createElement('strong');
      title.textContent = office;
      const holder = document.createElement('span');
      const holderId = holders.get(office);
      holder.textContent = holderId ? (names.get(holderId) || 'Assigned member') : 'Vacant';
      card.append(title, holder);
      officeList.append(card);
    });
    memberSelect.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = members.length ? 'Choose an approved member' : 'No approved members available';
    memberSelect.append(placeholder);
    members.forEach((member) => {
      const option = document.createElement('option');
      option.value = member.id;
      option.textContent = member.full_name;
      memberSelect.append(option);
    });
  }

  assignmentForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const office = officeSelect.value;
    const memberId = memberSelect.value;
    if (!office || !memberId) return;
    const submit = $('assign-super-admin');
    submit.disabled = true;
    submit.textContent = 'Saving appointment…';
    superAdminStatus.hidden = true;
    try {
      const { error } = await supabase.rpc('assign_super_admin_office', {
        p_target_user_id: memberId,
        p_office: office
      });
      if (error) throw error;
      showMessage(superAdminStatus, office + ' appointment saved successfully. The previous holder, if any, has been moved out of that office.', 'success');
      assignmentForm.reset();
      await loadSuperAdminPanel();
    } catch (error) {
      showMessage(superAdminStatus, error.message || 'The office appointment could not be saved.', 'error');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Save office appointment';
    }
  });


  async function loadAppointmentClaims(user, houseNames) {
    claimList.innerHTML = '<div class="admin-empty">Loading leadership claims…</div>';
    const { data: claims, error } = await supabase
      .from('appointments')
      .select('id, member_id, office_name, scope, prayer_house_id, nominated_at')
      .eq('verification_status', 'pending')
      .order('nominated_at', { ascending: true });
    if (error) throw error;

    if (!claims?.length) {
      claimList.innerHTML = '<div class="admin-empty">There are no pending leadership appointment claims in your authorized area.</div>';
      claimCount.textContent = '0';
      return;
    }

    const memberIds = [...new Set(claims.map((claim) => claim.member_id))];
    const { data: members, error: membersError } = await supabase
      .from('profiles')
      .select('id, full_name, primary_prayer_house_id')
      .in('id', memberIds);
    if (membersError) throw membersError;
    const memberMap = new Map((members || []).map((member) => [member.id, member]));

    claimCount.textContent = String(claims.length);
    claimList.replaceChildren();
    claims.forEach((claim) => {
      const member = memberMap.get(claim.member_id);
      const card = document.createElement('article');
      card.className = 'application-card';
      const heading = document.createElement('div');
      heading.className = 'application-heading';
      const name = document.createElement('h3');
      name.textContent = member?.full_name || 'Member';
      const scope = document.createElement('span');
      scope.className = 'claim-scope-tag';
      scope.textContent = claim.scope === 'parish' ? 'Parish-level claim' : (houseNames.get(claim.prayer_house_id) || 'Prayer-house claim');
      heading.append(name, scope);

      const meta = document.createElement('p');
      meta.className = 'application-meta';
      meta.textContent = claim.office_name + ' · Submitted ' + new Date(claim.nominated_at).toLocaleDateString();

      const actions = document.createElement('div');
      actions.className = 'application-actions';
      const verify = document.createElement('button');
      verify.type = 'button';
      verify.textContent = 'Verify appointment';
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.className = 'reject-claim';
      reject.textContent = 'Reject claim';

      async function reviewClaim(decision, button) {
        verify.disabled = true;
        reject.disabled = true;
        button.textContent = decision === 'verified' ? 'Verifying…' : 'Rejecting…';
        try {
          const { data, error: reviewError } = await supabase
            .from('appointments')
            .update({
              verification_status: decision,
              verified_by: user.id,
              verified_at: new Date().toISOString()
            })
            .eq('id', claim.id)
            .eq('verification_status', 'pending')
            .select('id')
            .maybeSingle();
          if (reviewError) throw reviewError;
          if (!data) throw new Error('This claim is no longer pending or is outside your administrator permissions.');

          card.remove();
          if (!claimList.querySelector('.application-card')) {
            claimList.innerHTML = '<div class="admin-empty">There are no pending leadership appointment claims in your authorized area.</div>';
          }
          claimCount.textContent = String(Math.max(0, Number(claimCount.textContent) - 1));
          showMessage(claimStatus, claim.office_name + ' claim ' + (decision === 'verified' ? 'verified' : 'rejected') + ' successfully.', 'success');
        } catch (reviewError) {
          showMessage(claimStatus, reviewError.message || 'The appointment claim could not be reviewed.', 'error');
          verify.disabled = false;
          reject.disabled = false;
          verify.textContent = 'Verify appointment';
          reject.textContent = 'Reject claim';
        }
      }

      verify.addEventListener('click', () => reviewClaim('verified', verify));
      reject.addEventListener('click', () => reviewClaim('rejected', reject));
      actions.append(verify, reject);
      card.append(heading, meta, actions);
      claimList.append(card);
    });
  }

  async function loadApplications() {
    status.hidden = true;
    list.innerHTML = '';
    list.setAttribute('aria-busy', 'true');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user;
      if (!user) {
        window.location.replace('login.html');
        return;
      }

      const { data: assignments, error: assignmentError } = await supabase
        .from('admin_assignments')
        .select('access_level, prayer_house_id')
        .eq('user_id', user.id)
        .eq('is_active', true);
      if (assignmentError) throw assignmentError;
      if (!assignments?.length) {
        window.location.replace('member-dashboard.html');
        return;
      }
      const heritageLink = $('history-manager-link');
      if (heritageLink) {
        heritageLink.hidden = !assignments.some((assignment) => ['parish_admin', 'super_admin'].includes(assignment.access_level));
      }
      if (assignments.some((assignment) => assignment.access_level === 'super_admin')) {
        await loadSuperAdminPanel();
      }

      const { data: houses, error: housesError } = await supabase
        .from('prayer_houses')
        .select('id, name');
      if (housesError) throw housesError;
      const houseNames = new Map((houses || []).map((house) => [house.id, house.name]));

      const { data: applications, error } = await supabase
        .from('profiles')
        .select('id, full_name, phone_private, primary_prayer_house_id, created_at')
        .eq('membership_status', 'pending')
        .order('created_at', { ascending: true });
      if (error) throw error;

      count.textContent = String(applications?.length || 0);
      if (!applications?.length) {
        list.innerHTML = '<div class="admin-empty">There are no pending membership applications.</div>';
      } else {
        applications.forEach((application) => {
        const card = document.createElement('article');
        card.className = 'application-card';

        const heading = document.createElement('div');
        heading.className = 'application-heading';
        const name = document.createElement('h2');
        name.textContent = application.full_name;
        const house = document.createElement('span');
        house.className = 'application-house';
        house.textContent = houseNames.get(application.primary_prayer_house_id) || 'Prayer house not selected';
        heading.append(name, house);

        const meta = document.createElement('p');
        meta.className = 'application-meta';
        const phone = application.phone_private || 'No phone supplied';
        const date = new Date(application.created_at).toLocaleDateString();
        meta.textContent = phone + ' · Registered ' + date;

        const actions = document.createElement('div');
        actions.className = 'application-actions';
        const approve = document.createElement('button');
        approve.type = 'button';
        approve.className = 'button';
        approve.textContent = 'Approve membership';
        approve.addEventListener('click', async () => {
          approve.disabled = true;
          approve.textContent = 'Approving…';
          try {
            const { error: reviewError } = await supabase
              .from('profiles')
              .update({ membership_status: 'approved', updated_at: new Date().toISOString() })
              .eq('id', application.id)
              .eq('membership_status', 'pending');
            if (reviewError) throw reviewError;
            card.remove();
            count.textContent = String(Math.max(0, Number(count.textContent) - 1));
            if (!list.querySelector('.application-card')) {
              list.innerHTML = '<div class="admin-empty">There are no pending membership applications.</div>';
            }
            showMessage(status, application.full_name + ' has been approved.', 'success');
          } catch (reviewError) {
            showAdminError(reviewError.message || 'The application could not be approved.');
            approve.disabled = false;
            approve.textContent = 'Approve membership';
          }
        });
        actions.append(approve);
        card.append(heading, meta, actions);
        list.append(card);
        });
      }

      await loadAppointmentClaims(user, houseNames);
    } catch (error) {
      showAdminError(error.message || 'Unable to load membership applications.');
    } finally {
      list.setAttribute('aria-busy', 'false');
    }
  }

  reload?.addEventListener('click', loadApplications);
  await loadApplications();
}

setupAdminDashboard();
