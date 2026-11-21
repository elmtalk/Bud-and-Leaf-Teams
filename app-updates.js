/* Bud&Leaf Teams PWA version check. Never silently reload fieldwork. */
(function(){
'use strict';
const build=String(window.BUDLEAF_BUILD_VERSION||'unknown');
const el=id=>document.getElementById(id);
let next='',dismissed='',checking=false,last=0,registration=null,applying=false;
const isOpen=id=>!!(el(id)&&!el(id).classList.contains('hidden'));
function busy(){
  try{
    return !!(state.walkBoundary||state.stemPlotter||state.pendingCreate||state.editLayer||
      state.contextDrawMode||state.rlbDrawMode||state.pendingDuplicate||
      state.textLabelDrawMode||state.contextEditingId||state.contextEditAllActive||
      isOpen('createSheet')||isOpen('featureSheet')||isOpen('editingBanner')||isOpen('rlbDrawingBanner'));
  }catch(err){return true;}
}
function detail(message){const target=el('blUpdateDetail');if(target)target.textContent=message;}
function available(v){
  next=v;if(dismissed===v || applying)return;
  el('blUpdateHeading').textContent='Update available — '+v;
  detail('Current: '+build+'. Update when you have finished active plotting.');
  el('blApplyUpdate').textContent='Update to '+v;
  el('blUpdatePrompt').classList.remove('hidden');
}
function markUpToDate(force){
  next='';el('blUpdatePrompt').classList.add('hidden');
  if(force){
    const btn=el('blCheckUpdates');if(btn){
      btn.textContent='Up to date';
      setTimeout(()=>{if(btn.isConnected)btn.textContent='Check updates';},1800);
    }
  }
}
async function check(force=false){
  if(checking || applying || !navigator.onLine || (!force && Date.now()-last<60000))return;
  checking=true;last=Date.now();
  try{
    if('serviceWorker' in navigator){
      registration=registration||await navigator.serviceWorker.getRegistration('./');
      if(registration)await registration.update();
    }
    // Metadata is never intercepted by the service worker. Compare against
    // the version of the JS actually running, not the newly downloaded worker.
    const res=await fetch('./version.json?check='+Date.now(),{cache:'no-store'});
    if(!res.ok)throw Error('Release lookup failed');
    const data=await res.json(),v=String(data.version||'').trim();
    if(!/^v\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.-]+)?$/.test(v))throw Error('Invalid release');
    if(v!==build)available(v);else markUpToDate(force);
  }catch(err){console.warn('Teams update check:',err);}
  finally{checking=false;}
}
async function apply(){
  if(!next || applying)return;
  if(busy()){detail('Finish or cancel your current plotting or editing before updating. No project data has been cleared.');return;}
  if(!navigator.onLine){detail('Connect to the internet first.');return;}
  applying=true;
  const button=el('blApplyUpdate');button.disabled=true;
  detail('Preparing the new app version…');
  try{
    if('serviceWorker' in navigator){
      registration=registration||await navigator.serviceWorker.getRegistration('./');
      if(registration){
        await registration.update();
        // register.update() can return while the worker is still installing.
        if(registration.installing && !registration.waiting){
          await new Promise(resolve=>{
            const worker=registration.installing;
            if(worker.state==='installed'||worker.state==='activated'||worker.state==='redundant'){resolve();return;}
            const done=()=>{if(worker.state==='installed'||worker.state==='activated'||worker.state==='redundant'){worker.removeEventListener('statechange',done);resolve();}};
            worker.addEventListener('statechange',done);
            setTimeout(()=>{worker.removeEventListener('statechange',done);resolve();},12000);
          });
        }
        if(registration.waiting){
          const changed=new Promise(resolve=>{
            navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true});
            setTimeout(resolve,6000);
          });
          registration.waiting.postMessage({type:'SKIP_WAITING'});
          await changed;
        }
      }
    }
    // Explicit tap is the only path that reloads the running survey app.
    location.reload();
  }catch(err){
    applying=false;button.disabled=false;
    detail('Update failed. Check connectivity and try again. Local projects are unchanged.');
    console.warn('Teams update apply:',err);
  }
}
el('blApplyUpdate')?.addEventListener('click',apply);
el('blLaterUpdate')?.addEventListener('click',()=>{dismissed=next;el('blUpdatePrompt').classList.add('hidden');});
el('blCheckUpdates')?.addEventListener('click',()=>{dismissed='';check(true);});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
window.addEventListener('online',()=>check(true));
window.addEventListener('focus',()=>check());
window.addEventListener('load',()=>check(true));
window.BudLeafUpdates={check,version:build};
})();
