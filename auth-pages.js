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

  const role = $('registration-role');
  const scope = $('claim-scope');
  const office = $('claim-office');
  const house = $('prayer-house');
  const leadershipFields = $('leadership-fields');
  const chaplainFields = $('chaplain-fields');
  const patronMatronFields = $('patron-matron-fields');
  const genderField = $('gender-field');
  const genderSelect = $('member-gender');
  const chaplainTitle = $('chaplain-title');
  const descriptions = {
    member: 'Register as an ordinary member of the youth group.',
    prayer_house_leader: 'Apply for a leadership office in your selected prayer house. Your application will be reviewed.',
    parish_leader: 'Apply for a parish-wide leadership office. Your application will be reviewed.',
    patron: 'Submit an application for the Patron appointment at parish or prayer-house level.',
    matron: 'Submit an application for the Matron appointment at parish or prayer-house level.',
    chaplain: 'Apply for the single Parish Chaplain appointment. Applicants must be male and select Father or Deacon.'
  };
  const claimOptions = {
    prayer_house: ['Chairperson', 'Vice Chairperson', 'Secretary', 'Vice Secretary', 'Treasurer', 'Organizing Secretary', 'Project Manager', 'Assistant Project Manager', 'Games Coordinator', 'Catechist', 'Patron', 'Matron'],
    parish: ['Chairperson', 'Vice Chairperson', 'Secretary', 'Vice Secretary', 'Treasurer', 'Organizing Secretary', 'Project Manager', 'Assistant Project Manager', 'Games Coordinator', 'Catechist', 'Patron', 'Matron']
  };

  function refreshClaimFields() {
    const selectedScope = scope.value;
    office.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose the leadership office';
    office.append(placeholder);
    (claimOptions[selectedScope] || []).forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      office.append(option);
    });
    office.disabled = !selectedScope;
    $('claim-note').textContent = selectedScope === 'parish'
      ? 'Parish office applications are reviewed by authorized parish leadership.'
      : 'Prayer-house office applications are linked to your selected prayer house and reviewed by authorized leaders.';
  }

  function refreshRoleFields() {
    const selected = role.value;
    const isHouseLeader = selected === 'prayer_house_leader';
    const isParishLeader = selected === 'parish_leader';
    const isChaplain = selected === 'chaplain';
    const isPatronMatron = selected === 'patron' || selected === 'matron';
    leadershipFields.hidden = !(isHouseLeader || isParishLeader);
    chaplainFields.hidden = !isChaplain;
    const houseField = $('prayer-house-field');
    if (houseField) houseField.hidden = isChaplain;
    house.required = !isChaplain;
    if (isChaplain) house.value = '';
    patronMatronFields.hidden = !isPatronMatron;
    scope.value = isHouseLeader ? 'prayer_house' : isParishLeader ? 'parish' : '';
    scope.disabled = true;
    refreshClaimFields();
    $('claim-scope').disabled = true;
    $('claim-office').required = isHouseLeader || isParishLeader;
    $('patron-claim-scope').value = selected === 'patron' ? 'parish' : '';
    $('matron-claim-scope').value = selected === 'matron' ? 'parish' : '';
    $('patron-claim-scope').required = selected === 'patron';
    $('matron-claim-scope').required = selected === 'matron';
    $('chaplain-claim').value = isChaplain ? 'parish' : '';
    $('chaplain-claim').disabled = true;
    genderField.hidden = !isChaplain;
    genderSelect.required = isChaplain;
    genderSelect.value = isChaplain ? 'male' : '';
    genderSelect.disabled = isChaplain;
    chaplainTitle.required = isChaplain;
    if (!isChaplain) chaplainTitle.value = '';
    $('role-description').textContent = descriptions[selected] || descriptions.member;
  }
  scope.addEventListener('change', refreshClaimFields);
  role.addEventListener('change', refreshRoleFields);
  refreshRoleFields();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = $('registration-message');
    hideMessage(message);

    const selectedRole = role.value;
    const fullName = $('full-name').value.trim();
    const email = $('email').value.trim().toLowerCase();
    const phone = $('phone').value.trim();
    const prayerHouseId = selectedRole === 'chaplain' ? null : house.value;
    const password = $('password').value;
    const confirmPassword = $('confirm-password').value;
    const claimScope = selectedRole === 'prayer_house_leader' ? 'prayer_house' : selectedRole === 'parish_leader' ? 'parish' : '';
    const selectedOffice = claimScope ? office.value : '';
    const isPatronMatronOffice = ['Patron', 'Matron'].includes(selectedOffice);
    const claimOffice = claimScope && !isPatronMatronOffice ? selectedOffice : '';
    const patronScope = selectedRole === 'patron' ? $('patron-claim-scope').value : '';
    const matronScope = selectedRole === 'matron' ? $('matron-claim-scope').value : '';
    const chaplainScope = selectedRole === 'chaplain' ? 'parish' : '';
    const gender = selectedRole === 'chaplain' ? 'male' : '';
    const title = selectedRole === 'chaplain' ? chaplainTitle.value : '';
    const patronMatronClaims = [];

    function addPatronMatronClaims(officeName, selectedScope) {
      if (!selectedScope) return;
      if (selectedScope === 'parish' || selectedScope === 'both') patronMatronClaims.push({ office_name: officeName, scope: 'parish' });
      if (selectedScope === 'prayer_house' || selectedScope === 'both') patronMatronClaims.push({ office_name: officeName, scope: 'prayer_house' });
    }
    if (isPatronMatronOffice) addPatronMatronClaims(selectedOffice, claimScope);
    addPatronMatronClaims('Patron', patronScope);
    addPatronMatronClaims('Matron', matronScope);

    const allowedSymbols = '!@#$%^&*()-_=+[]{}:,.?';
    const passwordIsStrong = password.length >= 12 && /[a-z]/.test(password) && /[A-Z]/.test(password)
      && /[0-9]/.test(password) && [...allowedSymbols].some((character) => password.includes(character));

    if (!passwordIsStrong) return showMessage(message, 'Use at least 12 characters, with uppercase and lowercase letters, a number and a symbol.', 'error');
    if (password !== confirmPassword) return showMessage(message, 'The two passwords do not match.', 'error');
    if ((claimScope && !selectedOffice) || (selectedRole === 'patron' && !patronScope) || (selectedRole === 'matron' && !matronScope)) {
      return showMessage(message, 'Choose the appointment level and office details required for your selected registration type.', 'error');
    }
    if (chaplainScope && (gender !== 'male' || !['Father', 'Deacon'].includes(title))) {
      return showMessage(message, 'Chaplain applicants must be male and select either Father or Deacon as their Church title.', 'error');
    }

    const submit = $('register-submit');
    submit.disabled = true;
    submit.textContent = 'Submitting registration…';
    try {
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: {
          emailRedirectTo: authCallbackUrl(),
          data: {
            full_name: fullName, phone, prayer_house_id: prayerHouseId,
            claim_scope: claimOffice ? claimScope : null, claim_office: claimOffice || null,
            gender: gender || null, chaplain_claim: chaplainScope || null,
            chaplain_title: title || null, patron_matron_claims: patronMatronClaims,
            registration_role: selectedRole
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
      refreshRoleFields();
      refreshClaimFields();
    } catch (error) {
      showMessage(message, error.message || 'Registration could not be completed. Please try again.', 'error');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Submit registration';
    }
  });
}

function setupLogin() {
  const form = $('login-form');
  if (!form) return;
  const submit = $('login-submit');
  // Attach the handler before enabling the button, so the browser can never
  // fall back to a native form submission while authentication is initialising.
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
  form.dataset.authReady = 'true';
  submit.disabled = false;
  submit.textContent = 'Sign in';
  hideMessage($('login-message'));
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
  let currentAdminUserId = null;

  async function loadSuperAdminPanel(currentUserId) {
    if (!superAdminPanel) return;
    superAdminPanel.hidden = false;
    officeList.innerHTML = '<div class="admin-empty">Loading office holders…</div>';
    const [membersResult, assignmentsResult] = await Promise.all([
      supabase.from('profiles').select('id, full_name').eq('membership_status', 'approved').order('full_name'),
      supabase.from('admin_assignments').select('id, user_id, super_admin_office').eq('access_level', 'super_admin').eq('is_active', true)
    ]);
    if (membersResult.error) throw membersResult.error;
    if (assignmentsResult.error) throw assignmentsResult.error;
    const members = membersResult.data || [];
    const holders = new Map((assignmentsResult.data || []).map((item) => [item.super_admin_office, item]));
    const names = new Map(members.map((member) => [member.id, member.full_name]));
    officeList.replaceChildren();
    superAdminOffices.forEach((office) => {
      const card = document.createElement('article');
      card.className = 'super-admin-office-card';
      const title = document.createElement('strong');
      title.textContent = office;
      const holder = document.createElement('span');
      const assignment = holders.get(office);
      holder.textContent = assignment ? (names.get(assignment.user_id) || 'Assigned member') : 'VACANT';
      card.append(title, holder);

      if (assignment?.user_id === currentUserId) {
        const stepDown = document.createElement('button');
        stepDown.type = 'button';
        stepDown.className = 'button button-light super-admin-step-down';
        stepDown.textContent = 'Voluntarily step down';
        stepDown.addEventListener('click', async () => {
          const confirmed = window.confirm(
            'Step down from ' + office + '? This will immediately make the office VACANT. Your member account and any other roles you hold will remain unchanged.'
          );
          if (!confirmed) return;
          stepDown.disabled = true;
          stepDown.textContent = 'Processing…';
          hideMessage(superAdminStatus);
          try {
            const { error } = await supabase.rpc('step_down_super_admin_office', { p_office: office });
            if (error) throw error;
            const { data: remaining, error: remainingError } = await supabase
              .from('admin_assignments')
              .select('access_level')
              .eq('user_id', currentUserId)
              .eq('is_active', true);
            if (remainingError) throw remainingError;

            if ((remaining || []).some((item) => item.access_level === 'super_admin')) {
              showMessage(superAdminStatus, 'You have stepped down from ' + office + '. The office is now marked VACANT.', 'success');
              await loadSuperAdminPanel(currentUserId);
            } else {
              superAdminPanel.hidden = true;
              if ((remaining || []).length) {
                showMessage(status, 'You have stepped down from ' + office + '. The office is now VACANT. Your other administrative role remains active.', 'success');
              } else {
                window.location.replace('member-dashboard.html');
              }
            }
          } catch (error) {
            showMessage(superAdminStatus, error.message || 'You could not step down from this office. Please try again.', 'error');
            stepDown.disabled = false;
            stepDown.textContent = 'Voluntarily step down';
          }
        });
        card.append(stepDown);
      }
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
      await loadSuperAdminPanel(currentAdminUserId);
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
      .select('id, full_name, primary_prayer_house_id, gender, chaplain_title')
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
      meta.textContent = claim.office_name + ' · Submitted ' + new Date(claim.nominated_at).toLocaleDateString()
        + (claim.office_name === 'Chaplain' ? ' · ' + (member?.chaplain_title || 'Church title not recorded') + ' · Gender: ' + (member?.gender || 'Not recorded') : '');

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
      currentAdminUserId = user.id;

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
      const galleryLink = $('gallery-manager-link');
      if (galleryLink) {
        galleryLink.hidden = !assignments.some((assignment) => ['parish_admin', 'super_admin'].includes(assignment.access_level));
      }
      if (assignments.some((assignment) => assignment.access_level === 'super_admin')) {
        await loadSuperAdminPanel(user.id);
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

// Keep notifications available on authenticated dashboard and administration pages.
import('./notifications.js').catch((error) => console.warn('Notification centre unavailable:', error));
