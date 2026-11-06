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
    window.location.replace('member-dashboard.html');
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
      window.location.replace('member-dashboard.html');
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
