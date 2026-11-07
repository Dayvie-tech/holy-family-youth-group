import { supabase } from './auth-client.js';

const style = document.createElement('link');
style.rel = 'stylesheet';
style.href = './notifications.css';
document.head.append(style);

const dateFormat = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
let currentUser = null;
let rows = [];
let channel = null;
let panelOpen = false;
let button, badge, panel, list, markAllButton, toast;

const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function notificationLabel(type) {
  return ({ announcement: 'ANNOUNCEMENT', event: 'EVENT', chat: 'CHAT', youth_voice: 'YOUTH VOICE' })[type] || 'UPDATE';
}

function unreadCount() {
  return rows.filter((item) => !item.read_at).length;
}

function render() {
  const count = unreadCount();
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.hidden = count === 0;
  list.replaceChildren();

  if (!rows.length) {
    list.append(make('div', 'notification-empty', 'You are all caught up. New parish updates will appear here.'));
    return;
  }

  rows.forEach((item) => {
    const card = make('article', 'notification-item' + (item.read_at ? '' : ' unread'));
    const top = make('div', 'notification-item-top');
    top.append(make('span', 'notification-type', notificationLabel(item.notification_type)));
    top.append(make('time', 'notification-time', dateFormat.format(new Date(item.created_at))));
    const title = make('h3', '', item.title);
    const message = make('p', '', item.message);
    const open = make('button', 'notification-open', item.read_at ? 'Open' : 'Open notification');
    open.type = 'button';
    open.addEventListener('click', () => openNotification(item));
    card.append(top, title, message, open);
    list.append(card);
  });
}

async function loadNotifications() {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, notification_type, title, message, target_url, created_at, read_at')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(40);
  if (error) throw error;
  rows = data || [];
  render();
}

async function openNotification(item) {
  if (!item.read_at) {
    const now = new Date().toISOString();
    const { error } = await supabase.from('notifications')
      .update({ read_at: now })
      .eq('id', item.id)
      .eq('user_id', currentUser.id);
    if (!error) {
      item.read_at = now;
      render();
    }
  }
  window.location.href = item.target_url;
}

async function markAllRead() {
  const unread = rows.filter((item) => !item.read_at);
  if (!unread.length) return;
  const now = new Date().toISOString();
  const { error } = await supabase.from('notifications')
    .update({ read_at: now })
    .eq('user_id', currentUser.id)
    .is('read_at', null);
  if (error) {
    toast.textContent = 'Notifications could not be marked as read. Please try again.';
    toast.hidden = false;
    return;
  }
  rows = rows.map((item) => item.read_at ? item : { ...item, read_at: now });
  render();
}

function showToast(item) {
  toast.textContent = item.title;
  toast.hidden = false;
  toast.classList.add('visible');
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    toast.classList.remove('visible');
    toast.hidden = true;
  }, 5200);
}

function mount() {
  const root = make('div', 'notification-root');
  button = make('button', 'notification-bell');
  button.type = 'button';
  button.setAttribute('aria-label', 'Open notifications');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = '<span aria-hidden="true">♧</span><span class="notification-bell-label">Notifications</span>';
  badge = make('span', 'notification-badge');
  badge.hidden = true;
  button.append(badge);

  panel = make('section', 'notification-panel');
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Notifications');
  const heading = make('div', 'notification-panel-heading');
  const headingText = make('div', '');
  headingText.append(make('span', 'notification-eyebrow', 'YOUR PARISH UPDATES'), make('h2', '', 'Notifications'));
  markAllButton = make('button', 'notification-mark-all', 'Mark all read');
  markAllButton.type = 'button';
  markAllButton.addEventListener('click', markAllRead);
  heading.append(headingText, markAllButton);
  list = make('div', 'notification-list');
  panel.append(heading, list);
  toast = make('div', 'notification-toast');
  toast.hidden = true;
  root.append(button, panel, toast);
  document.body.append(root);

  button.addEventListener('click', async () => {
    panelOpen = !panelOpen;
    panel.hidden = !panelOpen;
    button.setAttribute('aria-expanded', String(panelOpen));
    if (panelOpen) await loadNotifications().catch(() => {
      list.replaceChildren(make('div', 'notification-empty', 'Notifications are temporarily unavailable. Please try again.'));
    });
  });

  document.addEventListener('click', (event) => {
    if (!root.contains(event.target) && panelOpen) {
      panelOpen = false;
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panelOpen) {
      panelOpen = false;
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      button.focus();
    }
  });
}

async function initialise() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  currentUser = data.session?.user;
  if (!currentUser) return;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('membership_status')
    .eq('id', currentUser.id)
    .maybeSingle();
  if (profileError || profile?.membership_status !== 'approved') return;

  mount();
  await loadNotifications();
  channel = supabase.channel('member-notifications-' + currentUser.id)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: 'user_id=eq.' + currentUser.id
    }, (payload) => {
      if (rows.some((item) => item.id === payload.new.id)) return;
      rows.unshift(payload.new);
      rows = rows.slice(0, 40);
      render();
      showToast(payload.new);
    })
    .subscribe();
}

window.addEventListener('beforeunload', () => {
  if (channel) supabase.removeChannel(channel);
});

initialise().catch((error) => console.warn('Notifications could not be started:', error));
