import { supabase } from './auth-client.js';

const elements = {
  login: document.getElementById('home-login-link'),
  dashboard: document.getElementById('home-dashboard-link'),
  signOut: document.getElementById('home-sign-out-link'),
  register: document.getElementById('hero-register-link'),
  heroDashboard: document.getElementById('hero-dashboard-link')
};

function showLoggedOut() {
  elements.login.hidden = false;
  elements.dashboard.hidden = true;
  elements.signOut.hidden = true;
  elements.register.hidden = false;
  elements.heroDashboard.hidden = true;
}

function showLoggedIn(destination, label) {
  elements.login.hidden = true;
  elements.dashboard.hidden = false;
  elements.dashboard.href = destination;
  elements.dashboard.textContent = label;
  elements.signOut.hidden = false;
  elements.register.hidden = true;
  elements.heroDashboard.hidden = false;
  elements.heroDashboard.href = destination;
  elements.heroDashboard.textContent = label === 'Membership status' ? 'View membership status →' : 'Open my dashboard →';
}

async function updateHomepageNavigation(session) {
  if (!session?.user) {
    showLoggedOut();
    return;
  }

  // Keep account actions hidden until the signed-in user's access level is checked.
  elements.login.hidden = true;
  elements.register.hidden = true;
  elements.dashboard.hidden = true;
  elements.heroDashboard.hidden = true;
  elements.signOut.hidden = false;

  const userId = session.user.id;
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('membership_status')
    .eq('id', userId)
    .maybeSingle();

  if (profileError || !profile) {
    showLoggedIn('pending.html', 'Membership status');
    return;
  }

  if (profile.membership_status !== 'approved') {
    showLoggedIn('pending.html', 'Membership status');
    return;
  }

  const { data: assignments, error: assignmentError } = await supabase
    .from('admin_assignments')
    .select('access_level')
    .eq('user_id', userId)
    .eq('is_active', true);

  if (assignmentError) {
    // Do not guess an administrator destination if role lookup fails.
    elements.dashboard.hidden = true;
    elements.heroDashboard.hidden = true;
    return;
  }

  if (assignments?.length) {
    const houseOnly = assignments.every((assignment) => assignment.access_level === 'prayer_house_admin');
    const destination = houseOnly ? 'prayer-house-workspace.html' : 'admin-dashboard.html';
    showLoggedIn(destination, houseOnly ? 'Prayer-house workspace' : 'Admin dashboard');
    return;
  }

  showLoggedIn('member-dashboard.html', 'Member dashboard');
}

async function initialiseHomepageNavigation() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    showLoggedOut();
    return;
  }
  await updateHomepageNavigation(data.session);
}

elements.signOut?.addEventListener('click', async (event) => {
  event.preventDefault();
  elements.signOut.textContent = 'Signing out…';
  const { error } = await supabase.auth.signOut();
  if (error) {
    elements.signOut.textContent = 'Sign out';
    return;
  }
  showLoggedOut();
});

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') {
    showLoggedOut();
    return;
  }
  // Defer profile and role lookups until after the auth event callback completes.
  Promise.resolve().then(() => updateHomepageNavigation(session));
});

initialiseHomepageNavigation();
