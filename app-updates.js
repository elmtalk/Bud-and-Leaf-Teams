/* Bud&Leaf Teams PWA version check. Never silently reload fieldwork. */
(function(){
'use strict';
const build=String(window.BUDLEAF_BUILD_VERSION||'unknown');
const el=id=>document.getElementById(id);
let next='',dismissed='',checking=false,last=0,registration=null;
const isOpen=id=>!!(el(id)&&!el(id).classList.contains('hidden'));
function busy(){
  try{
    return !!(state.walkBoundary||state.stemPlotter||state.pendingCreate||state.editLayer||
      state.contextDrawMode||state.rlbDrawMode||state.pendingDuplicate||
      state.textLabelDrawMode||state.contextEditingId||state.contextEditAllActive||
      isOpen('createSheet')||isOpen('featureSheet')||isOpen('editingBanner')||isOpen('rlbDrawingBanner'));
  }catch(err){return true;}
}
function detail(t){el('blUpdateDetail').textContent=t;}
function available(v){
  next=v;if(dismissed===v)return;
  el('blUpdateHeading').textContent='Update available — '+v;
  detail('Current: '+build+'. Update when you have finished any active plotting.');
  el('blApplyUpdate').textContent='Update to '+v;
  el('blUpdatePrompt').classList.remove('hidden');
}
async function check(force=false){
  if(checking||!navigator.onLine||(!force&&Date.now()-last<60000))return;
  checking=true;last=Date.now();
  try{
    if('serviceWorker' in navigator){
      registration=registration||await navigator.serviceWorker.getRegistration('./');
      if(registration)await registration.update();
    }
    const res=await fetch('./version.json?check='+Date.now(),{cache:'no-store'});
    if(!res.ok)throw Error('Release lookup failed');
    const data=await res.json(),v=String(data.version||'').trim();
    if(!/^v\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.-]+)?$/.test(v))throw Error('Invalid release');
    if(v!==build)available(v);
    else{next='';el('blUpdatePrompt').classList.add('hidden');}
    if(force&&v===build){el('blCheckUpdates').textContent='Up to date';setTimeout(()=>el('blCheckUpdates').textContent='Check updates',1800);}
  }catch(err){console.warn('Teams update check:',err);}
  finally{checking=false;}
}
async function apply(){
  if(!next)return;
  if(busy()){detail('Finish or cancel your current plotting or editing before updating. No project data has been cleared.');return;}
  if(!navigator.onLine){detail('Connect to the internet first.');return;}
  el('blApplyUpdate').disabled=true;
  detail('Loading the new app version…');
  try{
    if('serviceWorker' in navigator){
      registration=registration||await navigator.serviceWorker.getRegistration('./');
      if(registration){await registration.update();if(registration.waiting)registration.waiting.postMessage({type:'SKIP_WAITING'});}
    }
    location.reload();
  }catch(err){el('blApplyUpdate').disabled=false;detail('Update failed. Check connectivity and try again.');console.warn(err);}
}
el('blApplyUpdate').addEventListener('click',apply);
el('blLaterUpdate').addEventListener('click',()=>{dismissed=next;el('blUpdatePrompt').classList.add('hidden');});
el('blCheckUpdates').addEventListener('click',()=>{dismissed='';check(true);});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
window.addEventListener('online',()=>check(true));
window.addEventListener('focus',()=>check());
window.addEventListener('load',()=>check(true));
window.BudLeafUpdates={check,version:build};
})();
