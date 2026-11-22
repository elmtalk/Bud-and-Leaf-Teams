import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, getDoc, getDocs, setDoc, updateDoc, writeBatch, serverTimestamp, Timestamp, deleteDoc } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'budleaf-invites-rules-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 }
});
after(async () => { await env.cleanup(); });

const owner = env.authenticatedContext('ownerUid',{email:'owner@example.com',email_verified:true}).firestore();
const surveyor = env.authenticatedContext('surveyorUid',{email:'surveyor@example.com',email_verified:true}).firestore();
const stranger = env.authenticatedContext('strangerUid',{email:'other@example.com',email_verified:true}).firestore();
const unverified = env.authenticatedContext('unverifiedUid',{email:'surveyor@example.com',email_verified:false}).firestore();
const anonymous = env.unauthenticatedContext().firestore();
const pid='abc12345-def6-4567-8910-aabbccddeeff', code='a'.repeat(48);
const root=db=>doc(db,'budleaf_projects',pid);
const member=(db,uid)=>doc(db,'budleaf_projects',pid,'members',uid);
const invitation=db=>doc(db,'budleaf_projects',pid,'invites',code);
const index=(db,uid)=>doc(db,'budleaf_users',uid,'projects',pid);

test('verified owner can create and list an owned project',async()=>{
  await assertSucceeds(setDoc(root(owner),{project_uuid:pid,owner_uid:'ownerUid',name:'Test survey'}));
  await assertSucceeds(setDoc(member(owner,'ownerUid'),{uid:'ownerUid',email:'owner@example.com',role:'owner',joined_at:serverTimestamp()}));
  await assertSucceeds(setDoc(index(owner,'ownerUid'),{project_uuid:pid,name:'Test survey',updated_at:serverTimestamp()}));
  await assertSucceeds(getDoc(root(owner)));
  await assertSucceeds(getDocs(collection(owner,'budleaf_users','ownerUid','projects')));
});
test('unrelated and anonymous users cannot access project or features',async()=>{
  await assertFails(getDoc(root(stranger)));
  await assertFails(getDocs(collection(stranger,'budleaf_projects')));
  await assertFails(getDoc(root(anonymous)));
  await assertFails(setDoc(doc(stranger,'budleaf_projects',pid,'features','ft1'),{feature_uuid:'ft1'}));
});
test('verified owner can invite a specified email and only that email can view code',async()=>{
  await assertSucceeds(setDoc(invitation(owner),{
    project_uuid:pid,project_name:'Test survey',email:'surveyor@example.com',
    role:'surveyor',created_by:'ownerUid',status:'pending',
    created_at:serverTimestamp(),expires_at:Timestamp.fromMillis(Date.now()+5*86400000)
  }));
  await assertSucceeds(getDoc(invitation(surveyor)));
  await assertFails(getDoc(invitation(stranger)));
  await assertFails(getDoc(invitation(unverified)));
});
test('wrong identity cannot accept, verified recipient accepts atomically',async()=>{
  const wrong=writeBatch(stranger);
  wrong.update(invitation(stranger),{status:'accepted',accepted_uid:'strangerUid',accepted_at:serverTimestamp()});
  wrong.set(member(stranger,'strangerUid'),{uid:'strangerUid',email:'other@example.com',role:'surveyor',invitation_id:code,joined_at:serverTimestamp()});
  wrong.set(index(stranger,'strangerUid'),{project_uuid:pid,name:'Test survey',updated_at:serverTimestamp()});
  await assertFails(wrong.commit());

  const batch=writeBatch(surveyor);
  batch.update(invitation(surveyor),{status:'accepted',accepted_uid:'surveyorUid',accepted_at:serverTimestamp()});
  batch.set(member(surveyor,'surveyorUid'),{uid:'surveyorUid',email:'surveyor@example.com',role:'surveyor',invitation_id:code,joined_at:serverTimestamp()});
  batch.set(index(surveyor,'surveyorUid'),{project_uuid:pid,name:'Test survey',updated_at:serverTimestamp()});
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDoc(root(surveyor)));
  await assertSucceeds(getDocs(collection(surveyor,'budleaf_users','surveyorUid','projects')));
  await assertSucceeds(setDoc(doc(surveyor,'budleaf_projects',pid,'features','tree123'),{feature_uuid:'tree123',updated_at:new Date().toISOString()}));
});
test('accepted invite cannot be replayed after owner revokes membership',async()=>{
  await assertSucceeds(deleteDoc(member(owner,'surveyorUid')));
  await assertFails(getDoc(root(surveyor)));
  const replay=writeBatch(surveyor);
  replay.set(member(surveyor,'surveyorUid'),{uid:'surveyorUid',email:'surveyor@example.com',role:'surveyor',invitation_id:code,joined_at:serverTimestamp()});
  replay.set(index(surveyor,'surveyorUid'),{project_uuid:pid,name:'Test survey',updated_at:serverTimestamp()});
  await assertFails(replay.commit());
});
