import { supabase } from './auth-client.js';

const $ = (id) => document.getElementById(id);
const status = $('chat-status');
const app = $('chat-app');
const roomList = $('chat-room-list');
const messagesEl = $('chat-messages');
const compose = $('chat-compose');
const input = $('chat-message-input');
const sendButton = $('chat-send');
const recordButton = $('chat-record-voice');
const cancelVoiceButton = $('chat-cancel-voice');
const sendVoiceButton = $('chat-send-voice');
const voicePreview = $('chat-voice-preview');
const recordingStatus = $('chat-recording-status');

const VOICE_BUCKET = 'chat-voice-notes';
const MAX_VOICE_SECONDS = 120;
const MAX_VOICE_BYTES = 5 * 1024 * 1024;

let currentUser = null;
let assignments = [];
let rooms = [];
let activeRoom = null;
let realtimeChannel = null;
let messageLoadSequence = 0;
let mediaRecorder = null;
let mediaStream = null;
let recordingChunks = [];
let recordingStartedAt = 0;
let recordingTimer = null;
let voiceBlob = null;
let voiceDurationSeconds = 0;
let voicePreviewUrl = null;
let voiceDraftRoomId = null;
let discardRecording = false;

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
function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
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
function attachVoicePlayer(container, message) {
  const wrapper = document.createElement('div');
  wrapper.className = 'chat-audio-message';
  const label = document.createElement('span');
  label.className = 'chat-audio-label';
  label.textContent = 'Voice note · ' + formatDuration(message.audio_duration_seconds);
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.preload = 'metadata';
  audio.setAttribute('aria-label', 'Voice note from ' + (message.author_display_name || 'member'));
  const unavailable = document.createElement('small');
  unavailable.className = 'chat-audio-unavailable';
  unavailable.textContent = 'Loading voice note…';
  wrapper.append(label, audio, unavailable);
  container.append(wrapper);

  supabase.storage.from(VOICE_BUCKET).createSignedUrl(message.audio_path, 3600).then(({ data, error }) => {
    if (!audio.isConnected) return;
    if (error || !data?.signedUrl) {
      unavailable.textContent = 'This voice note is temporarily unavailable.';
      return;
    }
    audio.src = data.signedUrl;
    unavailable.remove();
  }).catch(() => {
    if (unavailable.isConnected) unavailable.textContent = 'This voice note is temporarily unavailable.';
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
    card.append(meta);

    if (message.deleted_at) {
      const removed = document.createElement('div');
      removed.className = 'chat-message-body';
      removed.textContent = 'Message removed by an administrator.';
      card.append(removed);
    } else if (message.message_type === 'audio' && message.audio_path) {
      attachVoicePlayer(card, message);
    } else {
      const body = document.createElement('div');
      body.className = 'chat-message-body';
      body.textContent = message.body;
      card.append(body);
    }

    if (!message.deleted_at) {
      const actions = document.createElement('div');
      actions.className = 'chat-message-actions';
      if (message.author_id === currentUser.id && message.message_type === 'text') {
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
    .select('id, room_id, author_id, author_display_name, body, message_type, audio_path, audio_duration_seconds, created_at, edited_at, deleted_at')
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
function releaseMediaStream() {
  if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop());
  mediaStream = null;
}
function resetVoiceDraft() {
  if (recordingTimer) window.clearInterval(recordingTimer);
  recordingTimer = null;
  releaseMediaStream();
  if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl);
  voicePreviewUrl = null;
  voiceBlob = null;
  voiceDurationSeconds = 0;
  voiceDraftRoomId = null;
  voicePreview.pause();
  voicePreview.removeAttribute('src');
  voicePreview.hidden = true;
  cancelVoiceButton.hidden = true;
  sendVoiceButton.hidden = true;
  sendVoiceButton.disabled = true;
  recordButton.disabled = !activeRoom;
  recordButton.classList.remove('recording');
  recordButton.innerHTML = '<span aria-hidden="true">●</span> Record voice note';
  recordingStatus.textContent = 'Voice notes are limited to 2 minutes.';
  if (activeRoom) {
    input.disabled = false;
    sendButton.disabled = false;
  }
}
function updateRecordingClock() {
  const elapsed = Math.min(MAX_VOICE_SECONDS, Math.floor((Date.now() - recordingStartedAt) / 1000));
  recordingStatus.textContent = 'Recording ' + formatDuration(elapsed) + ' / ' + formatDuration(MAX_VOICE_SECONDS);
  if (elapsed >= MAX_VOICE_SECONDS && mediaRecorder?.state === 'recording') {
    showStatus('Two-minute limit reached. Your recording is ready to preview.', 'success');
    mediaRecorder.stop();
  }
}
async function startVoiceRecording() {
  if (!activeRoom) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showStatus('Voice recording is not supported by this browser. Try an updated Chrome, Edge or Safari browser.', 'error');
    return;
  }
  try {
    resetVoiceDraft();
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeOptions = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
    const selectedMime = mimeOptions.find((type) => MediaRecorder.isTypeSupported(type));
    mediaRecorder = new MediaRecorder(mediaStream, selectedMime ? { mimeType: selectedMime } : undefined);
    recordingChunks = [];
    discardRecording = false;
    voiceDraftRoomId = activeRoom.id;
    recordingStartedAt = Date.now();
    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size) recordingChunks.push(event.data);
    });
    mediaRecorder.addEventListener('stop', () => {
      const duration = Math.max(1, Math.min(MAX_VOICE_SECONDS, Math.round((Date.now() - recordingStartedAt) / 1000)));
      releaseMediaStream();
      if (discardRecording) {
        discardRecording = false;
        resetVoiceDraft();
        return;
      }
      const mime = mediaRecorder?.mimeType || selectedMime || 'audio/webm';
      voiceBlob = new Blob(recordingChunks, { type: mime });
      voiceDurationSeconds = duration;
      if (!voiceBlob.size || voiceBlob.size > MAX_VOICE_BYTES) {
        showStatus('This recording is empty or larger than 5 MB. Please record a shorter voice note.', 'error');
        resetVoiceDraft();
        return;
      }
      voicePreviewUrl = URL.createObjectURL(voiceBlob);
      voicePreview.src = voicePreviewUrl;
      voicePreview.hidden = false;
      cancelVoiceButton.hidden = false;
      sendVoiceButton.hidden = false;
      sendVoiceButton.disabled = false;
      recordButton.disabled = false;
      recordButton.classList.remove('recording');
      recordButton.innerHTML = '<span aria-hidden="true">●</span> Record again';
      recordingStatus.textContent = 'Preview your voice note (' + formatDuration(voiceDurationSeconds) + ') before sending.';
      input.disabled = false;
      sendButton.disabled = false;
    }, { once: true });
    mediaRecorder.start(250);
    recordButton.disabled = false;
    recordButton.classList.add('recording');
    recordButton.innerHTML = '<span aria-hidden="true">■</span> Stop recording';
    cancelVoiceButton.hidden = false;
    input.disabled = true;
    sendButton.disabled = true;
    recordingStatus.textContent = 'Recording 00:00 / 02:00';
    recordingTimer = window.setInterval(updateRecordingClock, 500);
  } catch (error) {
    releaseMediaStream();
    resetVoiceDraft();
    showStatus(error.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow microphone access and try again.' : 'Could not start recording: ' + error.message, 'error');
  }
}
function stopVoiceRecording() {
  if (mediaRecorder?.state === 'recording') {
    if (recordingTimer) window.clearInterval(recordingTimer);
    recordingTimer = null;
    mediaRecorder.stop();
  }
}
function discardVoiceNote() {
  if (mediaRecorder?.state === 'recording') {
    discardRecording = true;
    stopVoiceRecording();
  } else {
    resetVoiceDraft();
  }
}
async function sendVoiceNote() {
  if (!voiceBlob || !activeRoom || voiceDraftRoomId !== activeRoom.id) {
    showStatus('Record a new voice note for this conversation before sending.', 'error');
    return;
  }
  sendVoiceButton.disabled = true;
  recordButton.disabled = true;
  const mime = voiceBlob.type || 'audio/webm';
  const extension = mime.includes('ogg') ? 'ogg' : (mime.includes('mp4') ? 'mp4' : (mime.includes('aac') ? 'aac' : 'webm'));
  const randomId = window.crypto?.randomUUID ? window.crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
  const path = activeRoom.id + '/' + currentUser.id + '/' + randomId + '.' + extension;
  const { error: uploadError } = await supabase.storage.from(VOICE_BUCKET).upload(path, voiceBlob, {
    contentType: mime,
    cacheControl: '3600',
    upsert: false
  });
  if (uploadError) {
    sendVoiceButton.disabled = false;
    recordButton.disabled = false;
    showStatus('Voice note upload failed: ' + uploadError.message, 'error');
    return;
  }
  const { error: insertError } = await supabase.from('chat_messages').insert({
    room_id: activeRoom.id,
    body: '',
    message_type: 'audio',
    audio_path: path,
    audio_duration_seconds: voiceDurationSeconds
  });
  if (insertError) {
    await supabase.storage.from(VOICE_BUCKET).remove([path]);
    sendVoiceButton.disabled = false;
    recordButton.disabled = false;
    showStatus('Voice note was uploaded but could not be sent: ' + insertError.message, 'error');
    return;
  }
  resetVoiceDraft();
  showStatus('Voice note sent.', 'success');
  await loadMessages();
}
async function selectRoom(room) {
  if (mediaRecorder?.state === 'recording') discardVoiceNote();
  else resetVoiceDraft();
  activeRoom = room;
  renderRooms();
  $('chat-room-type').textContent = roomKind(room);
  $('chat-room-name').textContent = room.name;
  $('chat-room-description').textContent = roomDescription(room);
  input.disabled = false;
  sendButton.disabled = false;
  recordButton.disabled = false;
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
recordButton.addEventListener('click', () => {
  if (mediaRecorder?.state === 'recording') stopVoiceRecording();
  else startVoiceRecording();
});
cancelVoiceButton.addEventListener('click', discardVoiceNote);
sendVoiceButton.addEventListener('click', sendVoiceNote);

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
  const requestedRoomId = new URLSearchParams(window.location.search).get('room');
  const firstRoom = rooms.find((r) => r.id === requestedRoomId) || rooms.find((r) => r.room_type === 'general') || rooms[0];
  await selectRoom(firstRoom);
}
window.addEventListener('beforeunload', () => {
  if (recordingTimer) window.clearInterval(recordingTimer);
  releaseMediaStream();
  if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl);
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
});
initialise().catch((error) => showStatus(error.message || 'The chat could not be opened.', 'error'));
