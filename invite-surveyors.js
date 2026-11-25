(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const status = message => { const e=$('cloudInviteStatus'); if(e)e.textContent=message; };
  const accountStatus = message => { const e=$('cloudAccountStatus'); if(e)e.textContent=message; };
  const email = value => String(value || '').trim().toLowerCase();
  let lastInvite = null;

  function cloud() {
    if (!window.BudLeafCloud) throw new Error('Cloud integration has not loaded.');
    return window.BudLeafCloud;
  }
  function context() {
    const f=cloud().firebaseContext();
    if (!f.api || !f.auth) throw new Error('Connect Firebase first, then sign in with your surveyor account.');
    return f;
  }
  async function authReady() {
    await cloud().connect(null,true);
    return context();
  }
  async function verified() {
    const f=await authReady();
    const u=f.auth.currentUser;
    if(!u || u.isAnonymous)throw new Error('Sign in with your own email account first.');
    await f.api.reload(u);
    if (!u.emailVerified)throw new Error('Verify your email from the Firebase message first.');
    await cloud().connect(null,true);
    const ready=context();
    if (!ready.db || !ready.user)throw new Error('Could not initialise your verified Firebase session.');
    return ready;
  }
  function error(err) { return (err && (err.message || err.code)) || String(err); }
  function showError(target,err) {
    if(target==='account')accountStatus(error(err));
    else status(error(err));
  }
  async function createAccount() {
    const e=email($('cloudAccountEmail')?.value);
    const p=$('cloudAccountPassword')?.value||'';
    if(!e.includes('@')||p.length<8)throw new Error('Enter a valid email address and password of at least 8 characters.');
    const f=await authReady();
    const result=await f.api.createUserWithEmailAndPassword(f.auth,e,p);
    await f.api.sendEmailVerification(result.user);
    await f.api.signOut(f.auth);
    accountStatus('Verification email sent. Open it, then return to Bud&Leaf and sign in.');
    cloud().renderState();
  }
  async function signIn() {
    const e=email($('cloudAccountEmail')?.value),p=$('cloudAccountPassword')?.value||'';
    if(!e||!p)throw new Error('Enter your surveyor email and password.');
    const f=await authReady();
    await f.api.signInWithEmailAndPassword(f.auth,e,p);
    const u=f.auth.currentUser;
    await f.api.reload(u);
    if(!u.emailVerified) {
      await f.api.sendEmailVerification(u);
      accountStatus('Your email is not verified. Another verification email has been sent.');
      return;
    }
    const ok=await cloud().connect(null,false);
    if(!ok)throw new Error('Email verified, but Firebase connection could not be completed.');
    accountStatus('Signed in as '+u.email);
    await cloud().listCloudProjects();
  }
  async function refreshVerification() {
    const f=await authReady();
    if(!f.auth.currentUser || f.auth.currentUser.isAnonymous)throw new Error('Sign in after verifying your email.');
    await f.api.reload(f.auth.currentUser);
    if(!f.auth.currentUser.emailVerified)throw new Error('Email still unverified. Check your inbox and spam folder.');
    const ok=await cloud().connect(null,false);
    if(!ok)throw new Error('Verified email found, but could not connect.');
    accountStatus('Verified: '+f.auth.currentUser.email);
  }
  async function signOut() {
    const f=context();
    await f.api.signOut(f.auth);
    // Clear cached user connection without destroying local project data.
    cloud().disconnectAccount();
    lastInvite=null;
    $('cloudInviteShareBtn').disabled=true;
    accountStatus('Signed out. Local surveys remain on this device.');
    status('');
  }
  function getProject() {
    const project=typeof window.currentProject==='function'?window.currentProject():null;
    if(!project || !project.project_uuid)throw new Error('Select a project before inviting another surveyor.');
    if(!project.project_meta?.cloud_enabled)throw new Error('Enable cloud for this project first.');
    return project;
  }
  async function createSecureCopy() {
    await verified();
    const original=typeof window.currentProject==='function'?window.currentProject():null;
    if(!original)throw new Error('Select the local project to copy first.');
    if (!window.confirm('Create a separate secure copy of '+original.name+' for invited surveyors? The original project will remain unchanged. Photos stay local and are not uploaded to Firebase.'))return;
    if (typeof window.blankProject !== 'function' ||
        typeof window.putProjectDb !== 'function' ||
        typeof window.refreshProjects !== 'function') {
      throw new Error('Bud&Leaf project tools are not ready.');
    }
    const template=window.blankProject((original.name||'Project')+' (shared)');
    const duplicate=JSON.parse(JSON.stringify(original,(key,value)=>{
      if (key==='_linkedProjectFolderHandle' ||
          key==='projectsRootHandle' ||
          key==='cloud_deleted_features')return undefined;
      return value;
    }));
    duplicate.id=template.id;
    duplicate.project_uuid=template.project_uuid;
    duplicate.name=template.name;
    duplicate.created_at=new Date().toISOString();
    duplicate.updated_at=duplicate.created_at;
    duplicate.project_meta=duplicate.project_meta||{};
    duplicate.project_meta.project_uuid=duplicate.project_uuid;
    duplicate.project_meta.project_name=duplicate.name;
    duplicate.project_meta.cloud_enabled=true;
    duplicate.project_meta.cloud_origin_uuid=original.project_uuid||'';
    delete duplicate.project_meta.cloud_deleted_features;
    delete duplicate.project_meta.linked_folder_name;
    delete duplicate.project_meta.linked_folder_last_sync;
    delete duplicate._linkedProjectFolderHandle;
    delete duplicate.linked_folder_name;
    delete duplicate.linked_folder_last_sync;
    delete duplicate.project_folder_name;
    delete duplicate.project_file_base;
    await window.putProjectDb(duplicate);
    await window.refreshProjects(duplicate.id);
    if(typeof window.afterProjectOpenedUi==='function')window.afterProjectOpenedUi();
    if(typeof window.renderSetupStatus==='function')window.renderSetupStatus();
    status('Local secure copy created. Uploading to Firebase…');
    try{
      await cloud().syncNow();
      status('Secure cloud copy ready. Invite surveyors from this project. The original remains unchanged.');
    }catch(err){
      status('Secure local copy saved. Cloud upload failed: '+error(err)+'. Use Sync now before inviting.');
    }
  }
  async function createInvitation() {
    const f=await verified();
    const project=getProject();
    const target=email($('cloudInviteEmail')?.value);
    if(!target.includes('@'))throw new Error('Enter your colleague\'s email address.');
    if(target===email(f.user.email))throw new Error('You are already signed in as this email.');
    const root=await f.api.getDoc(f.api.doc(f.db,'budleaf_projects',project.project_uuid));
    if(!root.exists())throw new Error('Sync this project to Firebase before inviting anyone.');
    if(root.data().owner_uid!==f.user.uid)throw new Error('Only the project owner can invite surveyors.');
    const bytes=new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const code=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    await f.api.setDoc(f.api.doc(f.db,'budleaf_projects',project.project_uuid,'invites',code),{
      project_uuid:project.project_uuid,
      project_name:project.name||'Project',
      email:target,
      role:'surveyor',
      created_by:f.user.uid,
      status:'pending',
      created_at:f.api.serverTimestamp(),
      expires_at:f.api.Timestamp.fromMillis(Date.now()+7*86400000)
    });
    lastInvite={code,project_uuid:project.project_uuid,project_name:project.name||'Project',email:target};
    $('cloudInviteShareBtn').disabled=false;
    $('cloudInvitationResult').textContent='Invitation created for '+target+'. Code: '+code+'. Share it privately; expires in 7 days.';
    status('Invitation created. Share the code with the intended surveyor.');
  }
  function invitationText() {
    if(!lastInvite)throw new Error('Create an invitation first.');
    return 'Bud&Leaf project invitation\nProject: '+lastInvite.project_name+
      '\nInvited email: '+lastInvite.email+
      '\nProject ID: '+lastInvite.project_uuid+
      '\nInvitation code: '+lastInvite.project_uuid+'.'+lastInvite.code+
      '\nOpen Bud&Leaf → Cloud collaboration → Surveyor account. Sign in using the invited email, then select Invite surveyor / Join project and paste the code. This invitation expires after seven days.';
  }
  async function shareInvitation() {
    const text=invitationText();
    if(navigator.share){
      try { await navigator.share({title:'Bud&Leaf project invitation',text}); return; }
      catch(e){if(e.name==='AbortError')return;}
    }
    await navigator.clipboard.writeText(text);
    status('Invitation copied. Send it privately to the intended surveyor.');
  }
  function parseCode(value) {
    const m=String(value||'').trim().match(/^([\w-]{12,128})\.([a-f0-9]{48})$/i);
    if(!m)throw new Error('Paste the complete invitation code (project ID followed by the secret).');
    return {projectUuid:m[1],secret:m[2].toLowerCase()};
  }
  async function acceptInvitation() {
    const f=await verified();
    const {projectUuid,secret}=parseCode($('cloudInviteCode')?.value);
    const invitation=f.api.doc(f.db,'budleaf_projects',projectUuid,'invites',secret);
    const doc=await f.api.getDoc(invitation);
    if(!doc.exists())throw new Error('Invitation not found or not available to this account.');
    const invite=doc.data();
    if(email(invite.email)!==email(f.user.email))throw new Error('Sign in using the email address that was invited.');
    if(invite.status!=='pending')throw new Error('This invitation has already been used or revoked.');
    if(!invite.expires_at || invite.expires_at.toMillis()<=Date.now())throw new Error('Invitation expired. Request a new one.');
    const member=f.api.doc(f.db,'budleaf_projects',projectUuid,'members',f.user.uid);
    const index=f.api.doc(f.db,'budleaf_users',f.user.uid,'projects',projectUuid);
    const batch=f.api.writeBatch(f.db);
    batch.update(invitation,{status:'accepted',accepted_uid:f.user.uid,accepted_at:f.api.serverTimestamp()});
    batch.set(member,{uid:f.user.uid,email:email(f.user.email),role:'surveyor',invitation_id:secret,joined_at:f.api.serverTimestamp()});
    batch.set(index,{project_uuid:projectUuid,name:invite.project_name||'Shared project',updated_at:f.api.serverTimestamp()});
    await batch.commit();
    $('cloudInviteCode').value='';
    status('Invitation accepted. Open Cloud projects to download '+(invite.project_name||'the shared project')+'.');
    await cloud().listCloudProjects();
  }
  async function showMembers() {
    const f=await verified(),p=getProject();
    const root=await f.api.getDoc(f.api.doc(f.db,'budleaf_projects',p.project_uuid));
    if(!root.exists())throw new Error('Shared project not found.');
    const members=await f.api.getDocs(f.api.collection(f.db,'budleaf_projects',p.project_uuid,'members'));
    const rows=[];
    members.forEach(d=>{const m=d.data();rows.push((m.email||'Surveyor')+' ('+(m.role||'surveyor')+')');});
    $('cloudInviteMembersList').textContent=rows.length?rows.join(' · '):'No surveyors registered yet.';
  }
  function wire() {
    const bind=(id,fn,target='invite')=>{
      const e=$(id);if(!e)return;
      e.onclick=async()=>{
        e.disabled=true;
        try{await fn();}catch(err){showError(target,err);}
        finally{e.disabled=false;}
      };
    };
    bind('cloudCreateAccountBtn',createAccount,'account');
    bind('cloudSignInBtn',signIn,'account');
    bind('cloudVerifyAccountBtn',refreshVerification,'account');
    bind('cloudSignOutBtn',signOut,'account');
    bind('cloudInviteCreateBtn',createInvitation);
    bind('cloudCreateSecureCopyBtn',createSecureCopy);
    bind('cloudInviteShareBtn',shareInvitation);
    bind('cloudInviteAcceptBtn',acceptInvitation);
    bind('cloudInviteMembersBtn',showMembers);
  }
  window.BudLeafInvites={createInvitation,acceptInvitation};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);
  else wire();
})();
