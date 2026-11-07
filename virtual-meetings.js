import { supabase } from './auth-client.js';

const $ = (id) => document.getElementById(id);
const statusBox = $('meeting-status');
const list = $('meeting-list');
const loading = $('meeting-loading');
const app = $('virtual-meetings-app');
const createSection = $('meeting-create-section');
const form = $('meeting-create-form');
let currentUser = null;
let isSuperAdmin = false;
let assignedHouseIds = [];
let houseNames = new Map();

function status(message, type = 'info') {
  statusBox.textContent = message;
  statusBox.className = 'form-message ' + type;
  statusBox.hidden = false;
}
function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function formatDate(value) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
function canManage(meeting) {
  return isSuperAdmin || (meeting.prayer_house_id != null && assignedHouseIds.includes(meeting.prayer_house_id));
}
function makeInviteToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadMeetings() {
  list.replaceChildren(node('div','admin-empty','Loading meetings…'));
  const { data, error } = await supabase.from('virtual_meetings')
    .select('id,title,description,visibility,prayer_house_id,starts_at,ends_at,status,created_by')
    .eq('status','scheduled').order('starts_at',{ascending:true});
  if (error) throw error;
  list.replaceChildren();
  if (!data?.length) {
    list.append(node('div','admin-empty','There are no upcoming meetings visible to your account yet.'));
    return;
  }
  data.forEach((meeting) => {
    const card = node('article','meeting-card');
    const top = node('div','meeting-card-top');
    const heading = node('div');
    heading.append(node('h3','',meeting.title));
    const scope = meeting.visibility === 'parish' ? 'Parish-wide' :
      (meeting.visibility === 'prayer_house' ? (houseNames.get(meeting.prayer_house_id) || 'Prayer-house meeting') : 'Invitation only');
    heading.append(node('p','meeting-meta',scope + ' · ' + formatDate(meeting.starts_at) + ' – ' + formatDate(meeting.ends_at)));
    top.append(heading,node('span','meeting-tag','SCHEDULED'));
    card.append(top);
    if (meeting.description) card.append(node('p','meeting-description',meeting.description));
    const actions = node('div','meeting-actions');
    actions.append(node('span','meeting-meta','Live video joining will be added in the next milestone.'));
    if (canManage(meeting)) {
      const cancel = node('button','danger','Cancel meeting');
      cancel.type = 'button';
      cancel.addEventListener('click', async () => {
        if (!window.confirm('Cancel “' + meeting.title + '”? Members will no longer see it as upcoming.')) return;
        cancel.disabled = true;
        const { error: updateError } = await supabase.from('virtual_meetings')
          .update({status:'cancelled',updated_at:new Date().toISOString()}).eq('id',meeting.id);
        if (updateError) { status(updateError.message,'error'); cancel.disabled = false; return; }
        status('Meeting cancelled.','success');
        await loadMeetings();
      });
      actions.append(cancel);
      const inviteToggle = node('button','','Invite an external guest');
      inviteToggle.type = 'button';
      const inviteForm = node('form','guest-invite-form');
      inviteForm.hidden = true;
      const nameLabel = node('label','','Guest name');
      const nameInput = node('input'); nameInput.required = true; nameInput.maxLength = 120; nameInput.placeholder = 'Full name';
      nameLabel.append(nameInput);
      const emailLabel = node('label','','Guest email');
      const emailInput = node('input'); emailInput.type='email'; emailInput.required=true; emailInput.maxLength=254; emailInput.placeholder='guest@example.com';
      emailLabel.append(emailInput);
      const send = node('button','','Create invite link'); send.type='submit';
      inviteForm.append(nameLabel,emailLabel,send);
      const output = node('div','guest-link-output'); output.hidden = true;
      inviteToggle.addEventListener('click',()=>{inviteForm.hidden=!inviteForm.hidden;});
      inviteForm.addEventListener('submit',async(event)=>{
        event.preventDefault(); send.disabled=true; send.textContent='Creating…'; output.hidden=true;
        try {
          const token=makeInviteToken(); const tokenHash=await sha256(token);
          const {error:insertError}=await supabase.from('virtual_meeting_invitations').insert({
            meeting_id:meeting.id,guest_name:nameInput.value.trim(),guest_email:emailInput.value.trim().toLowerCase(),
            invite_token_hash:tokenHash,created_by:currentUser.id
          });
          if(insertError) throw insertError;
          const inviteUrl=new URL('virtual-meetings.html?guest='+token,window.location.href).href;
          output.replaceChildren(node('strong','','Guest invitation link created. Share it privately with '+nameInput.value.trim()+':'));
          output.append(node('p','',inviteUrl));
          const copy=node('button','','Copy invitation link'); copy.type='button';
          copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(inviteUrl);copy.textContent='Copied';}catch{status('Copy was blocked by this browser. Select and copy the invitation link above.','error');}});
          output.append(copy); output.hidden=false; inviteForm.reset();
          status('Invitation link created. It has not been emailed automatically; share it privately with the guest.','success');
        } catch(error){status(error.message||'Could not create the invitation.','error');}
        finally{send.disabled=false;send.textContent='Create invite link';}
      });
      card.append(actions,inviteToggle,inviteForm,output);
    } else card.append(actions);
    list.append(card);
  });
}

async function loadGuestInvite(token) {
  loading.textContent='Checking your invitation…';
  try {
    const tokenHash=await sha256(token);
    const {data,error}=await supabase.rpc('get_guest_virtual_meeting_invite',{p_token_hash:tokenHash});
    if(error) throw error;
    const invite=Array.isArray(data)?data[0]:null;
    if(!invite){loading.textContent='This invitation is invalid, expired or has been cancelled.';return;}
    $('guest-invite-title').textContent='You’re invited, '+invite.guest_name;
    $('guest-invite-details').textContent=invite.title+' · '+formatDate(invite.starts_at)+' – '+formatDate(invite.ends_at)+(invite.description?' · '+invite.description:'');
    $('guest-invite-panel').hidden=false;
    loading.hidden=true;
  } catch(error){loading.textContent=error.message||'Unable to verify this invitation.';}
}

async function initialize() {
  const guestToken=new URLSearchParams(window.location.search).get('guest');
  if(guestToken){await loadGuestInvite(guestToken);return;}
  try {
    const {data:sessionData}=await supabase.auth.getSession();
    currentUser=sessionData.session?.user;
    if(!currentUser){window.location.replace('login.html?next=virtual-meetings.html');return;}
    const {data:profile,error:profileError}=await supabase.from('profiles')
      .select('membership_status,primary_prayer_house_id').eq('id',currentUser.id).single();
    if(profileError) throw profileError;
    if(profile.membership_status!=='approved'){window.location.replace('pending.html');return;}
    const {data:assignments,error:assignmentError}=await supabase.from('admin_assignments')
      .select('access_level,prayer_house_id').eq('user_id',currentUser.id).eq('is_active',true);
    if(assignmentError) throw assignmentError;
    isSuperAdmin=(assignments||[]).some(item=>item.access_level==='super_admin');
    assignedHouseIds=(assignments||[]).filter(item=>item.access_level==='prayer_house_admin').map(item=>item.prayer_house_id);
    const {data:houses,error:houseError}=await supabase.from('prayer_houses').select('id,name').eq('is_active',true);
    if(houseError) throw houseError;
    houseNames=new Map((houses||[]).map(house=>[house.id,house.name]));
    const scopeSelect=$('meeting-visibility');
    const houseWrap=$('meeting-house-wrap');
    const houseSelect=$('meeting-house');
    if(isSuperAdmin||assignedHouseIds.length){
      createSection.hidden=false;
      if(!isSuperAdmin){
        scopeSelect.replaceChildren(new Option('Prayer-house members','prayer_house'),new Option('Invitation only','invite_only'));
      }
      const allowedHouses=(houses||[]).filter(house=>isSuperAdmin||assignedHouseIds.includes(house.id));
      houseSelect.replaceChildren(...allowedHouses.map(house=>new Option(house.name,String(house.id))));
      const updateScope=()=>{houseWrap.hidden=scopeSelect.value==='parish';};
      scopeSelect.addEventListener('change',updateScope);updateScope();
    }
    loading.hidden=true;app.hidden=false;
    await loadMeetings();
  } catch(error){loading.textContent=error.message||'Unable to load the Virtual Meetings module.';}
}

form.addEventListener('submit',async(event)=>{
  event.preventDefault();
  const title=$('meeting-title').value.trim();
  const visibility=$('meeting-visibility').value;
  const houseId=visibility==='parish'?null:Number($('meeting-house').value);
  const startsAt=new Date($('meeting-start').value);
  const endsAt=new Date($('meeting-end').value);
  if(!title||Number.isNaN(startsAt.getTime())||Number.isNaN(endsAt.getTime())||endsAt<=startsAt){status('Enter a valid title and ensure the end time is after the start time.','error');return;}
  if(startsAt<=new Date()){status('Choose a future meeting start time.','error');return;}
  const button=$('meeting-create-submit');button.disabled=true;button.textContent='Scheduling…';
  try{
    const {error}=await supabase.from('virtual_meetings').insert({
      title,description:$('meeting-description').value.trim(),visibility,prayer_house_id:houseId,
      starts_at:startsAt.toISOString(),ends_at:endsAt.toISOString(),created_by:currentUser.id
    });
    if(error) throw error;
    status('Meeting scheduled successfully. Eligible members have received an in-app notification.','success');
    form.reset();$('meeting-house-wrap').hidden=true;
    await loadMeetings();
  }catch(error){status(error.message||'The meeting could not be scheduled.','error');}
  finally{button.disabled=false;button.textContent='Schedule meeting';}
});

$('meeting-refresh').addEventListener('click',()=>loadMeetings().catch(error=>status(error.message,'error')));
$('meeting-sign-out').addEventListener('click',async()=>{await supabase.auth.signOut();window.location.replace('index.html');});
initialize();
