import { supabase } from './auth-client.js';
const $ = (id) => document.getElementById(id);
const money = (value) => new Intl.NumberFormat('en-KE',{style:'currency',currency:'KES',minimumFractionDigits:2}).format(Number(value||0));
let adminHouseIds=[];let isParishLevelAdmin=false;
function showAdminStatus(message,type='info'){const el=$('contribution-admin-status');el.textContent=message;el.className=`form-message ${type}`;el.hidden=false;}
function makeElement(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
async function loadPublicProgress(){
 const status=$('contribution-progress-status');const container=$('public-house-progress');status.textContent='Loading collective progress…';container.replaceChildren();
 const {data,error}=await supabase.from('prayer_house_contribution_public_totals').select('prayer_house_id,prayer_house_name,target_amount,total_contributed,remaining_balance').order('prayer_house_id');
 if(error)throw error;const rows=data||[];
 const target=rows.reduce((s,r)=>s+Number(r.target_amount||0),0);const paid=rows.reduce((s,r)=>s+Number(r.total_contributed||0),0);const balance=Math.max(target-paid,0);
 $('parish-target').textContent=money(target);$('parish-contributed').textContent=money(paid);$('parish-balance').textContent=money(balance);
 for(const row of rows){
  const goal=Number(row.target_amount||0),amount=Number(row.total_contributed||0),percent=goal>0?Math.min(amount/goal*100,100):0;
  const card=makeElement('article','house-progress-card');card.append(makeElement('h3','',row.prayer_house_name));
  const values=makeElement('div','house-progress-values');const paidNode=makeElement('div');paidNode.append(makeElement('span','','Total contributed'),makeElement('strong','',money(amount)));
  const targetNode=makeElement('div');targetNode.append(makeElement('span','','House target'),makeElement('strong','',money(goal)));values.append(paidNode,targetNode);
  const track=makeElement('div','house-progress-track');track.setAttribute('role','progressbar');track.setAttribute('aria-label',`${row.prayer_house_name} collective contribution progress`);track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');track.setAttribute('aria-valuenow',String(Math.round(percent)));
  const fill=makeElement('div','house-progress-fill');fill.style.width=`${percent}%`;track.append(fill);
  card.append(values,track,makeElement('div','house-progress-caption',goal>0?`${percent.toFixed(1)}% of the house target`:'A collective target has not yet been set.'));container.append(card);
 }
 if(!rows.length)container.append(makeElement('div','contribution-empty','No active prayer houses are currently available.'));
 status.textContent='Showing collective prayer-house progress. Individual member payments are never displayed.';
}
async function getAdminAccess(user){
 const [{data:profile,error:profileError},{data:assignments,error:assignmentError}]=await Promise.all([
  supabase.from('profiles').select('membership_status').eq('id',user.id).single(),
  supabase.from('admin_assignments').select('access_level,prayer_house_id').eq('user_id',user.id).eq('is_active',true)
 ]);
 if(profileError)throw profileError;if(assignmentError)throw assignmentError;if(profile.membership_status!=='approved')return null;
 const active=assignments||[];const parishRole=active.some(x=>['parish_admin','super_admin'].includes(x.access_level));
 const houseIds=[...new Set(active.filter(x=>x.access_level==='prayer_house_admin').map(x=>x.prayer_house_id).filter(Boolean))];
 return parishRole||houseIds.length?{parishRole,houseIds}:null;
}
async function loadAdminWorkspace(user){
 const access=await getAdminAccess(user);if(!access)return;isParishLevelAdmin=access.parishRole;
 const {data:allHouses,error}=await supabase.from('prayer_houses').select('id,name').eq('is_active',true).order('id');if(error)throw error;
 const visible=access.parishRole?(allHouses||[]):(allHouses||[]).filter(h=>access.houseIds.includes(h.id));adminHouseIds=visible.map(h=>h.id);
 $('contribution-admin').hidden=false;$('contribution-admin-prompt').hidden=true;
 $('contribution-admin-scope').textContent=access.parishRole?'Record contributions and review collective records across all eight prayer houses.':'Record combined contributions received by your assigned prayer house. Individual member payments are not recorded.';
 const select=$('contribution-house');select.replaceChildren();
 for(const house of visible){const option=document.createElement('option');option.value=String(house.id);option.textContent=house.name;select.append(option);}
 if(!visible.length){select.append(new Option('No assigned prayer house found',''));select.disabled=true;}
 const now=new Date();$('contribution-date').value=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
 $('contribution-target-section').hidden=!access.parishRole;
 await Promise.all([loadContributionRecords(),access.parishRole?loadTargets(visible):Promise.resolve()]);
}
async function loadContributionRecords(){
 const list=$('contribution-record-list');list.replaceChildren(makeElement('p','admin-empty','Loading contribution records…'));
 let query=supabase.from('prayer_house_contributions').select('id,prayer_house_id,amount,contribution_date,created_at,prayer_houses(name)').order('contribution_date',{ascending:false}).order('created_at',{ascending:false}).limit(100);
 if(!isParishLevelAdmin)query=query.in('prayer_house_id',adminHouseIds);
 const {data,error}=await query;if(error)throw error;list.replaceChildren();
 if(!data?.length){list.append(makeElement('div','contribution-empty','No house contribution records have been entered yet.'));return;}
 for(const row of data){const item=makeElement('article','contribution-record');const details=makeElement('div');details.append(makeElement('strong','',row.prayer_houses?.name||'Prayer house'));details.append(makeElement('span','',new Date(`${row.contribution_date}T00:00:00`).toLocaleDateString('en-KE',{day:'numeric',month:'short',year:'numeric'})));item.append(details,makeElement('span','contribution-record-amount',money(row.amount)));list.append(item);}
}
async function loadTargets(houses){
 const list=$('contribution-target-list');list.replaceChildren(makeElement('p','admin-empty','Loading house targets…'));
 const {data,error}=await supabase.from('prayer_house_contribution_targets').select('prayer_house_id,target_amount').in('prayer_house_id',houses.map(h=>h.id));if(error)throw error;
 const targets=new Map((data||[]).map(r=>[r.prayer_house_id,r.target_amount]));list.replaceChildren();
 for(const house of houses){
  const form=makeElement('form','target-row');form.append(makeElement('strong','',house.name));const label=makeElement('label','','Collective target (KES)');
  const input=makeElement('input');input.type='number';input.min='0';input.step='0.01';input.required=true;input.value=String(targets.get(house.id)??0);label.append(input);
  const button=makeElement('button','button button-light','Save target');button.type='submit';form.append(label,button);
  form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;try{const amount=Number(input.value);if(!Number.isFinite(amount)||amount<0)throw new Error('Enter a valid target amount.');
   const {error:updateError}=await supabase.from('prayer_house_contribution_targets').update({target_amount:amount}).eq('prayer_house_id',house.id);if(updateError)throw updateError;
   showAdminStatus(`Target updated for ${house.name}.`,'success');await loadPublicProgress();
  }catch(err){showAdminStatus(err.message||'Unable to update this target.','error');}finally{button.disabled=false;}});
  list.append(form);
 }
}
$('contribution-entry-form').addEventListener('submit',async event=>{
 event.preventDefault();const button=event.currentTarget.querySelector('button[type="submit"]');const houseId=Number($('contribution-house').value),amount=Number($('contribution-amount').value),date=$('contribution-date').value;
 if(!adminHouseIds.includes(houseId)){showAdminStatus('You are not authorised to record contributions for that prayer house.','error');return;}
 if(!Number.isFinite(amount)||amount<=0||!date){showAdminStatus('Enter a valid amount and date.','error');return;}
 button.disabled=true;try{const {error}=await supabase.from('prayer_house_contributions').insert({prayer_house_id:houseId,amount,contribution_date:date});if(error)throw error;
 $('contribution-amount').value='';showAdminStatus('Prayer-house contribution recorded successfully.','success');await Promise.all([loadPublicProgress(),loadContributionRecords()]);
 }catch(err){showAdminStatus(err.message||'Unable to save the contribution.','error');}finally{button.disabled=false;}
});
$('refresh-contribution-records').addEventListener('click',async()=>{try{await Promise.all([loadContributionRecords(),loadPublicProgress()]);showAdminStatus('Contribution records and public totals refreshed.','success');}catch(err){showAdminStatus(err.message||'Unable to refresh contribution records.','error');}});
async function initialize(){
 try{await loadPublicProgress();}catch(err){$('contribution-progress-status').textContent=err.message||'Collective progress could not be loaded.';}
 const {data,error}=await supabase.auth.getSession();if(error||!data.session?.user)return;
 try{await loadAdminWorkspace(data.session.user);}catch(err){showAdminStatus(err.message||'The contribution workspace could not be loaded.','error');$('contribution-admin').hidden=false;$('contribution-admin-prompt').hidden=true;}
}
initialize();
