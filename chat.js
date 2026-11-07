import { supabase } from './auth-client.js';

const $ = (id) => document.getElementById(id);
const status = $('chat-status');
const app = $('chat-app');
const roomList = $('chat-room-list');
const messagesEl = $('chat-messages');
const compose = $('chat-compose');
const input = $('chat-message-input');
const sendButton = $('chat-send');

let currentUser = null;
let assignments = [];
let rooms = [];
let activeRoom = null;
let realtimeChannel = null;
let messageLoadSequence = 0;

function showStatus(message, type = '') {
  status.textContent = message;
  status.className = 'chat-status' + (type ? ' ' + type : '');
  status.hidden = false;
}
function roomKind(room) {
  if (room.room_type === 'general') return 'PARISH-WIDE CHAT';
  if (room.room_type === 'leadership') return 'LEADERSHIP CHAT';
  return 'PRAYER HOUSE CHAT';
}
function roomDescription(room) {
  if (room.room_type === 'general') return 'A shared conversation for all approved parish youth members.';
  if (room.room_type === 'leadership') return 'For verified leaders and authorised administrators.';
  return 'A private conversation for members and authorised administrators of this prayer house.';
}
function canModerate(room) {
  const parishAdmin = assignments.some((a) => a.is_active && ['parish_admin', 'super_admin'].includes(a.access_level));
  if (room.room_type === 'leadership' || room.room_type === 'general') return parishAdmin;
  return parishAdmin || assignments.some((a) =>
    a.is_active && a.access_level === 'prayer_house_admin' && Number(a.prayer_house_id) === Number(room.prayer_house_id)
  );
}
function formatTime(value) {
  return new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
function makeButton(label, className, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.className = className || '';
  button.addEventListener('click', handler);
  return button;
}
function renderRooms() {
  roomList.replaceChildren();
  rooms.forEach((room) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chat-room-button' + (activeRoom?.id === room.id ? ' active' : '');
    const name = document.createElement('strong');
    name.textContent = room.name;
    const kind = document.createElement('small');
    kind.textContent = roomKind(room);
    button.append(name, kind);
    button.addEventListener('click', () => selectRoom(room));
    roomList.append(button);
  });
}
function renderMessages(rows) {
  messagesEl.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.textContent = 'No messages here yet. Start the conversation respectfully.';
    messagesEl.append(empty);
    return;
  }
  rows.forEach((message) => {
    const card = document.createElement('article');
    card.className = 'chat-message' + (message.author_id === currentUser.id ? ' mine' : '') + (message.deleted_at ? ' removed' : '');
    const meta = document.createElement('div');
    meta.className = 'chat-message-meta';
    const author = document.createElement('strong');
    author.textContent = message.author_display_name || 'Member';
    const time = document.createElement('time');
    time.dateTime = message.created_at;
    time.textContent = formatTime(message.created_at);
    meta.append(author, time);
    if (message.edited_at && !message.deleted_at) {
      const edited = document.createElement('span');
      edited.className = 'edited-label';
      edited.textContent = 'edited';
      meta.append(edited);
    }
    const body = document.createElement('div');
    body.className = 'chat-message-body';
    body.textContent = message.body;
    card.append(meta, body);

    if (!message.deleted_at) {
      const actions = document.createElement('div');
      actions.className = 'chat-message-actions';
      if (message.author_id === currentUser.id) {
        actions.append(makeButton('Edit', '', () => editMessage(message)));
      }
      if (canModerate(activeRoom)) {
        actions.append(makeButton('Remove', 'danger', () => removeMessage(message)));
      }
      if (actions.childElementCount) card.append(actions);
    }
    messagesEl.append(card);
  });
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
async function loadMessages() {
  const room = activeRoom;
  if (!room) return;
  const requestSequence = ++messageLoadSequence;
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, room_id, author_id, author_display_name, body, created_at, edited_at, deleted_at')
    .eq('room_id', room.id)
    .order('created_at', { ascending: true })
    .limit(150);
  if (requestSequence !== messageLoadSequence || activeRoom?.id !== room.id) return;
  if (error) {
    showStatus('Could not load this conversation: ' + error.message, 'error');
    return;
  }
  renderMessages(data || []);
}
async function selectRoom(room) {
  activeRoom = room;
  renderRooms();
  $('chat-room-type').textContent = roomKind(room);
  $('chat-room-name').textContent = room.name;
  $('chat-room-description').textContent = roomDescription(room);
  input.disabled = false;
  sendButton.disabled = false;
  messagesEl.innerHTML = '<div class="chat-empty">Loading conversation…</div>';
  if (realtimeChannel) {
    await supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  await loadMessages();
  realtimeChannel = supabase
    .channel('chat-room-' + room.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: 'room_id=eq.' + room.id }, () => loadMessages())
    .subscribe((state) => {
      if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
        showStatus('Live updates are temporarily unavailable. You can still refresh the conversation.', 'error');
      }
    });
}
async function editMessage(message) {
  const next = window.prompt('Edit your message:', message.body);
  if (next === null) return;
  const body = next.trim();
  if (!body || body.length > 2000) {
    showStatus('A message must contain between 1 and 2,000 characters.', 'error');
    return;
  }
  const { error } = await supabase.from('chat_messages').update({ body }).eq('id', message.id);
  if (error) {
    showStatus('Your message could not be edited: ' + error.message, 'error');
    return;
  }
  showStatus('Message updated.', 'success');
  await loadMessages();
}
async function removeMessage(message) {
  if (!window.confirm('Remove this message from the conversation?')) return;
  const { error } = await supabase.rpc('moderate_chat_message', { p_message_id: message.id });
  if (error) {
    showStatus('The message could not be removed: ' + error.message, 'error');
    return;
  }
  showStatus('Message removed.', 'success');
  await loadMessages();
}
compose.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!activeRoom) return;
  const body = input.value.trim();
  if (!body || body.length > 2000) return;
  sendButton.disabled = true;
  const { error } = await supabase.from('chat_messages').insert({ room_id: activeRoom.id, body });
  sendButton.disabled = false;
  if (error) {
    showStatus('Message not sent: ' + error.message, 'error');
    return;
  }
  input.value = '';
  await loadMessages();
});
async function initialise() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  currentUser = sessionData.session?.user;
  if (!currentUser) {
    window.location.replace('login.html');
    return;
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('full_name, display_name, membership_status, primary_prayer_house_id')
    .eq('id', currentUser.id)
    .single();
  if (profileError || !profile) throw new Error('Your member profile could not be loaded.');
  if (profile.membership_status !== 'approved') {
    window.location.replace(profile.membership_status === 'pending' ? 'pending.html' : 'login.html');
    return;
  }
  $('chat-member-greeting').textContent = 'Signed in as ' + (profile.display_name || profile.full_name);

  const [assignmentResult, roomResult] = await Promise.all([
    supabase.from('admin_assignments').select('access_level, prayer_house_id, is_active').eq('user_id', currentUser.id).eq('is_active', true),
    supabase.from('chat_rooms').select('id, room_type, name, prayer_house_id').order('room_type').order('name')
  ]);
  if (assignmentResult.error) throw assignmentResult.error;
  if (roomResult.error) throw roomResult.error;
  assignments = assignmentResult.data || [];
  rooms = roomResult.data || [];
  if (!rooms.length) throw new Error('No chat rooms are available to this account. Check your membership and prayer-house assignment.');
  app.hidden = false;
  status.hidden = true;
  renderRooms();
  const firstRoom = rooms.find((r) => r.room_type === 'general') || rooms[0];
  await selectRoom(firstRoom);
}
window.addEventListener('beforeunload', () => {
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
});
initialise().catch((error) => showStatus(error.message || 'The chat could not be opened.', 'error'));
