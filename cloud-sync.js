(function () {
  'use strict';

  const FIREBASE_VERSION = '13.3.0';
  const FIREBASE_BASE = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VERSION + '/';
  const CONFIG_KEY = 'budleaf_firebase_config_v1';
  const DEVICE_KEY = 'budleaf_cloud_device_id_v1';
  const UPLOAD_PREFIX = 'budleaf_cloud_uploaded_';

  let api = null;
  let app = null;
  let auth = null;
  let db = null;
  let currentUser = null;
  let currentUnsubscribe = null;
  let currentProjectUuid = '';
  let syncTimer = null;
  let connecting = false;

  function el(id) { return document.getElementById(id); }

  function cloneJson(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function deviceId() {
    let value = '';
    try { value = localStorage.getItem(DEVICE_KEY) || ''; } catch (e) {}
    if (value) return value;
    try {
      value = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('device_' + Date.now() + '_' + Math.random().toString(36).slice(2));
      localStorage.setItem(DEVICE_KEY, value);
    } catch (e) {
      value = 'device_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    }
    return value;
  }

  function setStatus(message, tone) {
    const box = el('cloudStatus');
    if (!box) return;
    box.textContent = message;
    box.dataset.tone = tone || '';
  }

  function projectUploadKey(projectUuid) {
    return UPLOAD_PREFIX + String(projectUuid || '');
  }

  function readUploadMap(projectUuid) {
    try { return JSON.parse(localStorage.getItem(projectUploadKey(projectUuid)) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function writeUploadMap(projectUuid, map) {
    try { localStorage.setItem(projectUploadKey(projectUuid), JSON.stringify(map || {})); }
    catch (e) {}
  }

  function savedConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveConfig(config) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }

  function forgetConfig() {
    try { localStorage.removeItem(CONFIG_KEY); } catch (e) {}
  }

  function parseConfigText(text) {
    let raw = String(text || '').trim();
    if (!raw) throw new Error('Paste the Firebase web app config first.');

    // Accept either the firebaseConfig object on its own or the entire code
    // snippet copied from Firebase's "Add Firebase SDK" screen.
    const marker = raw.search(/(?:const|let|var)\s+firebaseConfig\s*=\s*{/);
    if (marker >= 0) {
      const objectStart = raw.indexOf('{', marker);
      let depth = 0;
      let quote = '';
      let escaped = false;
      let objectEnd = -1;
      for (let i = objectStart; i < raw.length; i++) {
        const ch = raw[i];
        if (quote) {
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === quote) quote = '';
          continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) { objectEnd = i; break; }
        }
      }
      if (objectEnd > objectStart) raw = raw.slice(objectStart, objectEnd + 1);
    } else {
      const braceStart = raw.indexOf('{');
      const braceEnd = raw.lastIndexOf('}');
      if (braceStart >= 0 && braceEnd > braceStart) raw = raw.slice(braceStart, braceEnd + 1);
    }

    try {
      return JSON.parse(raw);
    } catch (e) {
      const jsonish = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
        .replace(/'/g, '"')
        .replace(/,\s*}/g, '}');
      try { return JSON.parse(jsonish); }
      catch (err) { throw new Error('Could not read the Firebase config. Paste the firebaseConfig object or the full Firebase setup snippet.'); }
    }
  }

  function validateConfig(config) {
    if (!config || typeof config !== 'object') throw new Error('Firebase config is missing.');
    const required = ['apiKey', 'projectId', 'appId'];
    const missing = required.filter(key => !config[key]);
    if (missing.length) throw new Error('Firebase config is missing: ' + missing.join(', '));
    return config;
  }

  async function loadFirebaseApi() {
    if (api) return api;
    const [appMod, authMod, fsMod] = await Promise.all([
      import(FIREBASE_BASE + 'firebase-app.js'),
      import(FIREBASE_BASE + 'firebase-auth.js'),
      import(FIREBASE_BASE + 'firebase-firestore.js')
    ]);
    api = Object.assign({}, appMod, authMod, fsMod);
    return api;
  }

  async function connect(configOverride, quiet) {
    if (db && currentUser) {
      renderState();
      return true;
    }
    if (connecting) return false;
    connecting = true;
    try {
      const config = validateConfig(configOverride || savedConfig());
      setStatus('Connecting to Firebase…');
      const f = await loadFirebaseApi();
      const appName = 'budleaf-cloud';
      const existing = f.getApps().find(item => item.name === appName);
      app = existing || f.initializeApp(config, appName);

      auth = f.getAuth(app);
      if (typeof auth.authStateReady === 'function') await auth.authStateReady();
      if (!auth.currentUser || auth.currentUser.isAnonymous) {
        currentUser = null;
        setStatus('Connect Firebase, then sign in using a verified surveyor email.', 'warn');
        renderState();
        return false;
      }
      await f.reload(auth.currentUser);
      if (!auth.currentUser.emailVerified) {
        currentUser = null;
        setStatus('Verify your surveyor email, then press “I\'ve verified my email”.', 'warn');
        renderState();
        return false;
      }
      currentUser = auth.currentUser;
      await currentUser.getIdToken(true);

      try {
        db = f.initializeFirestore(app, {
          localCache: f.persistentLocalCache({
            tabManager: f.persistentMultipleTabManager()
          })
        });
      } catch (e) {
        db = f.getFirestore(app);
      }

      setStatus('Cloud connected · local saves remain active.', 'ok');
      renderState();
      const project = (typeof window.currentProject === 'function') ? window.currentProject() : null;
      if (project) projectChanged(project);
      if (!quiet) await listCloudProjects();
      return true;
    } catch (err) {
      console.warn('Bud&Leaf cloud connection failed', err);
      setStatus('Cloud not connected: ' + (err && err.message ? err.message : err), 'error');
      renderState();
      return false;
    } finally {
      connecting = false;
    }
  }

  function isProjectCloudEnabled(project) {
    return !!(project && project.project_meta && project.project_meta.cloud_enabled);
  }

  function cleanProjectMeta(meta) {
    const out = cloneJson(meta || {}) || {};
    delete out._linkedProjectFolderHandle;
    return out;
  }

  function cloudProjectPayload(project) {
    return {
      app: 'Bud&Leaf',
      cloud_schema: 'budleaf-cloud-v0.1',
      project_uuid: project.project_uuid,
      schema_version: project.schema_version || '1.1',
      name: project.name || 'Project',
      survey_mode: project.survey_mode || 'BS5837',
      created_at: project.created_at || '',
      updated_at: project.updated_at || '',
      schema_json: JSON.stringify(cloneJson(project.schema || [])),
      project_meta_json: JSON.stringify(cleanProjectMeta(project.project_meta)),
      red_line_boundary_json: JSON.stringify(cloneJson(project.red_line_boundary || null)),
      topo_reference_json: JSON.stringify(cloneJson(project.topo_reference || null)),
      context_features_json: JSON.stringify(cloneJson(project.context_features || [])),
      source_device_id: deviceId(),
      cloud_written_at: api.serverTimestamp()
    };
  }

  function cloudFeaturePayload(feature) {
    const copy = cloneJson(feature) || {};
    copy.properties = copy.properties || {};
    const photos = Array.isArray(copy.properties.photos) ? copy.properties.photos : [];
    copy.properties.photo_count = photos.length;
    copy.properties.photo_names = photos.map(p => p && (p.name || p.filename) || '').filter(Boolean);
    delete copy.properties.photos;
    const uuid = String(copy.properties.feature_uuid || '');
    return {
      feature_uuid: uuid,
      updated_at: copy.properties.updated_at || '',
      surveyor_code: copy.properties.surveyor_code || '',
      surveyor_name: copy.properties.surveyor_name || '',
      source_device_id: deviceId(),
      deleted: false,
      feature_json: JSON.stringify(copy),
      cloud_written_at: api.serverTimestamp()
    };
  }

  function ensureDeletedList(project) {
    project.project_meta = project.project_meta || {};
    if (!Array.isArray(project.project_meta.cloud_deleted_features)) project.project_meta.cloud_deleted_features = [];
    return project.project_meta.cloud_deleted_features;
  }

  function noteFeatureDeleted(project, feature) {
    if (!project || !feature || !feature.properties || !feature.properties.feature_uuid) return;
    const list = ensureDeletedList(project);
    const uuid = String(feature.properties.feature_uuid);
    const when = (typeof window.nowIso === 'function') ? window.nowIso() : new Date().toISOString();
    const existing = list.find(item => String(item && item.feature_uuid || '') === uuid);
    if (existing) existing.updated_at = when;
    else list.push({ feature_uuid: uuid, updated_at: when });
    scheduleSync(project);
  }

  async function pushDeletedFeatures(project) {
    const list = ensureDeletedList(project);
    if (!list.length) return 0;
    let count = 0;
    for (const item of list) {
      if (!item || !item.feature_uuid) continue;
      const ref = api.doc(db, 'budleaf_projects', project.project_uuid, 'features', String(item.feature_uuid));
      await api.setDoc(ref, {
        feature_uuid: String(item.feature_uuid),
        updated_at: item.updated_at || '',
        source_device_id: deviceId(),
        deleted: true,
        cloud_written_at: api.serverTimestamp()
      }, { merge: true });
      count += 1;
    }
    return count;
  }

  async function pushProject(project, force) {
    if (!project || !project.project_uuid || !isProjectCloudEnabled(project)) return false;
    if (!db && !(await connect(null, true))) return false;

    const projectRef = api.doc(db, 'budleaf_projects', project.project_uuid);
    let existing = null;
    try {
      existing = await api.getDoc(projectRef);
    } catch (err) {
      // A non-existent secured project may be unreadable under Firestore rules.
      // A create is permitted only if its owner_uid is this verified user.
      if (err.code !== 'permission-denied') throw err;
    }
    if (!existing || !existing.exists()) {
      // Only the signed-in verified owner can create a new shared project.
      try {
        await api.setDoc(projectRef, Object.assign(cloudProjectPayload(project), {
          owner_uid: currentUser.uid
        }));
      } catch (err) {
        if (err.code === 'permission-denied') {
          throw new Error('This project UUID is already occupied or inaccessible. Export a ZIP and create a new project rather than overwrite the existing cloud project.');
        }
        throw err;
      }
      await api.setDoc(api.doc(db, 'budleaf_projects', project.project_uuid, 'members', currentUser.uid), {
        uid: currentUser.uid, email: currentUser.email.toLowerCase(), role: 'owner',
        joined_at: api.serverTimestamp()
      });
    } else if (!existing.data().owner_uid) {
      throw new Error('This project UUID belongs to a legacy anonymous cloud record. It cannot be claimed automatically. Keep a ZIP backup and create a separate secured project with a fresh UUID; restoring or renaming the old project does not change its UUID.');
    } else {
      await api.setDoc(projectRef, cloudProjectPayload(project), { merge: true });
    }
    await api.setDoc(api.doc(db, 'budleaf_users', currentUser.uid, 'projects', project.project_uuid), {
      project_uuid: project.project_uuid, name: project.name || 'Project',
      updated_at: api.serverTimestamp()
    }, { merge: true });

    const uploadMap = readUploadMap(project.project_uuid);
    let featureWrites = 0;
    const features = Array.isArray(project.features) ? project.features : [];

    for (const feature of features) {
      const props = feature && feature.properties || {};
      const uuid = String(props.feature_uuid || '');
      if (!uuid) continue;
      const stamp = String(props.updated_at || '');
      if (!force && uploadMap[uuid] === stamp) continue;
      const ref = api.doc(db, 'budleaf_projects', project.project_uuid, 'features', uuid);
      await api.setDoc(ref, cloudFeaturePayload(feature), { merge: true });
      uploadMap[uuid] = stamp;
      featureWrites += 1;
    }

    const deletedWrites = await pushDeletedFeatures(project);
    writeUploadMap(project.project_uuid, uploadMap);
    setStatus('Cloud synced · ' + featureWrites + ' feature change' + (featureWrites === 1 ? '' : 's') + (deletedWrites ? ' · ' + deletedWrites + ' deletion(s)' : '') + '.', 'ok');
    ensureProjectListener(project);
    return true;
  }

  function scheduleSync(project) {
    if (!project || !isProjectCloudEnabled(project)) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      pushProject(project, false).catch(function (err) {
        console.warn('Bud&Leaf cloud sync failed', err);
        setStatus('Saved locally · cloud sync pending.', 'warn');
      });
    }, 900);
  }

  function featureTime(feature) {
    return String(feature && feature.properties && feature.properties.updated_at || '');
  }

  function remoteTime(remote) {
    return String(remote && (remote.updated_at || (remote.feature && remote.feature.properties && remote.feature.properties.updated_at)) || '');
  }

  function addSurveyorToRegistry(project, props) {
    const code = String(props && props.surveyor_code || '').trim().toUpperCase();
    const name = String(props && props.surveyor_name || '').trim();
    if (!code || !name) return;
    project.project_meta = project.project_meta || {};
    const registry = Array.isArray(project.project_meta.teams_surveyors) ? project.project_meta.teams_surveyors : [];
    if (!registry.some(entry => String(entry && entry.code || '').toUpperCase() === code)) {
      registry.push({ code: code, name: name });
      project.project_meta.teams_surveyors = registry;
    }
  }

  function parseJsonField(value, fallback) {
    if (typeof value !== 'string') return fallback;
    try { return JSON.parse(value); }
    catch (e) { return fallback; }
  }

  function remoteFeature(remote) {
    const fromJson = parseJsonField(remote && remote.feature_json, null);
    if (fromJson) return fromJson;
    return cloneJson(remote && remote.feature);
  }

  async function applyRemoteSnapshot(projectUuid, snapshot) {
    const project = (typeof window.currentProject === 'function') ? window.currentProject() : null;
    if (!project || String(project.project_uuid || '') !== String(projectUuid)) return;

    let changed = false;
    const uploadMap = readUploadMap(projectUuid);
    project.features = Array.isArray(project.features) ? project.features : [];
    const deletedList = ensureDeletedList(project);

    snapshot.docChanges().forEach(change => {
      const remote = change.doc.data() || {};
      const uuid = String(remote.feature_uuid || change.doc.id || '');
      if (!uuid) return;
      const index = project.features.findIndex(feature => String(feature && feature.properties && feature.properties.feature_uuid || '') === uuid);

      if (remote.deleted) {
        if (index >= 0) {
          project.features.splice(index, 1);
          changed = true;
        }
        if (!deletedList.some(item => String(item && item.feature_uuid || '') === uuid)) {
          deletedList.push({ feature_uuid: uuid, updated_at: remote.updated_at || '' });
        }
        delete uploadMap[uuid];
        return;
      }

      const incoming = remoteFeature(remote);
      if (!incoming || !incoming.properties) return;
      incoming.properties.feature_uuid = incoming.properties.feature_uuid || uuid;

      if (index < 0) {
        incoming.properties.photos = [];
        project.features.push(incoming);
        addSurveyorToRegistry(project, incoming.properties);
        uploadMap[uuid] = String(incoming.properties.updated_at || '');
        changed = true;
        return;
      }

      const local = project.features[index];
      const localStamp = featureTime(local);
      const incomingStamp = remoteTime(remote);
      if (incomingStamp && incomingStamp > localStamp) {
        const localPhotos = Array.isArray(local.properties && local.properties.photos) ? local.properties.photos : [];
        incoming.properties.photos = localPhotos;
        project.features[index] = incoming;
        addSurveyorToRegistry(project, incoming.properties);
        uploadMap[uuid] = String(incoming.properties.updated_at || '');
        changed = true;
      } else if (localStamp && localStamp > incomingStamp) {
        scheduleSync(project);
      }
    });

    writeUploadMap(projectUuid, uploadMap);
    if (!changed) return;

    project.updated_at = (typeof window.nowIso === 'function') ? window.nowIso() : new Date().toISOString();
    if (typeof window.putProjectDb === 'function') await window.putProjectDb(project);
    if (typeof window.renderCurrentProjectSummary === 'function') window.renderCurrentProjectSummary();
    if (typeof window.renderProjectList === 'function') window.renderProjectList();
    if (typeof window.renderSetupStatus === 'function') window.renderSetupStatus();
    if (typeof window.rebuildMap === 'function') window.rebuildMap();
    setStatus('Cloud received collaborator changes.', 'ok');
  }

  function stopProjectListener() {
    if (currentUnsubscribe) {
      try { currentUnsubscribe(); } catch (e) {}
    }
    currentUnsubscribe = null;
    currentProjectUuid = '';
  }

  function ensureProjectListener(project) {
    if (!db || !project || !project.project_uuid || !isProjectCloudEnabled(project)) {
      stopProjectListener();
      return;
    }
    if (currentUnsubscribe && currentProjectUuid === project.project_uuid) return;
    stopProjectListener();
    currentProjectUuid = project.project_uuid;
    const ref = api.collection(db, 'budleaf_projects', project.project_uuid, 'features');
    currentUnsubscribe = api.onSnapshot(ref, function (snapshot) {
      applyRemoteSnapshot(project.project_uuid, snapshot).catch(function (err) {
        console.warn('Bud&Leaf incoming cloud update failed', err);
        setStatus('Cloud update could not be applied: ' + (err.message || err), 'error');
      });
    }, function (err) {
      console.warn('Bud&Leaf cloud listener failed', err);
      setStatus('Cloud listener stopped: ' + (err.message || err), 'error');
    });
  }

  async function enableCurrentProject() {
    const project = (typeof window.currentProject === 'function') ? window.currentProject() : null;
    if (!project) {
      setStatus('Select or create a project first.', 'warn');
      return;
    }
    if (!(await connect(null, true))) return;
    project.project_meta = project.project_meta || {};
    const previouslyEnabled = !!project.project_meta.cloud_enabled;
    project.project_meta.cloud_enabled = true;
    try {
      // Do not persist the enabled flag until the first authorised cloud write
      // succeeds. A failed migration must leave the local survey usable.
      const synced = await pushProject(project, true);
      if (!synced) throw new Error('Cloud connection unavailable. Local project unchanged.');
      if (typeof window.saveCurrentProject === 'function') await window.saveCurrentProject(true);
      ensureProjectListener(project);
      setStatus('Cloud enabled and first sync completed.', 'ok');
    } catch (err) {
      project.project_meta.cloud_enabled = previouslyEnabled;
      setStatus('Could not enable cloud: ' + (err && err.message ? err.message : err) + ' Local project is unchanged.', 'error');
      console.warn('Bud&Leaf cloud enable failed', err);
    } finally {
      renderState();
    }
  }

  async function disableCurrentProject() {
    const project = (typeof window.currentProject === 'function') ? window.currentProject() : null;
    if (!project) return;
    project.project_meta = project.project_meta || {};
    project.project_meta.cloud_enabled = false;
    if (typeof window.saveCurrentProject === 'function') await window.saveCurrentProject(true);
    stopProjectListener();
    setStatus('Cloud sync disabled for this project. Local saving is unchanged.', 'ok');
    renderState();
  }

  async function syncNow() {
    const project = (typeof window.currentProject === 'function') ? window.currentProject() : null;
    if (!project) {
      setStatus('Select a project first.', 'warn');
      return;
    }
    if (!isProjectCloudEnabled(project)) {
      setStatus('Enable cloud for this project first.', 'warn');
      return;
    }
    await pushProject(project, true);
  }

  async function listCloudProjects() {
    if (!db && !(await connect(null, true))) return;
    const box = el('cloudProjectsList');
    if (box) box.innerHTML = '<div class="clean-muted">Loading cloud projects…</div>';
    try {
      const snap = await api.getDocs(api.collection(db, 'budleaf_users', currentUser.uid, 'projects'));
      const rows = [];
      snap.forEach(docSnap => {
        const data = docSnap.data() || {};
        rows.push({
          uuid: String(data.project_uuid || docSnap.id),
          name: String(data.name || 'Project'),
          updated_at: String(data.updated_at || ''),
          mode: String(data.survey_mode || '')
        });
      });
      rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      if (!box) return;
      if (!rows.length) {
        box.innerHTML = '<div class="clean-muted">No cloud projects yet.</div>';
        return;
      }
      box.innerHTML = rows.map(row =>
        '<div class="project-item"><div class="project-meta"><div class="project-title">' +
        escapeHtmlSafe(row.name) + '</div><div class="muted">' +
        escapeHtmlSafe(row.mode) + ' · ' + escapeHtmlSafe(row.updated_at.replace('T', ' ').slice(0, 16) || 'date unknown') +
        '</div></div><div class="project-actions"><button class="btn" data-cloud-open="' +
        escapeHtmlSafe(row.uuid) + '">Open</button></div></div>'
      ).join('');
      box.querySelectorAll('[data-cloud-open]').forEach(button => {
        button.onclick = function () {
          openCloudProject(button.dataset.cloudOpen).catch(function (err) {
            setStatus('Could not open cloud project: ' + (err.message || err), 'error');
          });
        };
      });
    } catch (err) {
      console.warn('Could not list cloud projects', err);
      const reason = err && err.code === 'permission-denied'
        ? 'Firestore permission denied. Check that the secured Bud&Leaf Firestore rules are deployed for this Firebase project.'
        : (err && err.message ? err.message : String(err));
      if (box) box.innerHTML = '<div class="clean-muted">Could not list cloud projects: ' + escapeHtmlSafe(reason) + '</div>';
      setStatus('Could not list cloud projects: ' + reason, 'error');
    }
  }

  function escapeHtmlSafe(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char];
    });
  }

  async function openCloudProject(projectUuid) {
    if (!db && !(await connect(null, true))) return;
    const rootSnap = await api.getDoc(api.doc(db, 'budleaf_projects', projectUuid));
    if (!rootSnap.exists()) throw new Error('Cloud project not found.');
    const root = rootSnap.data() || {};
    const featureSnap = await api.getDocs(api.collection(db, 'budleaf_projects', projectUuid, 'features'));

    let localProjects = [];
    if (typeof window.listProjectsDb === 'function') localProjects = await window.listProjectsDb();
    let project = localProjects.find(item => String(item && item.project_uuid || '') === String(projectUuid)) || null;

    if (!project) {
      if (typeof window.blankProject !== 'function') throw new Error('Bud&Leaf project creator is unavailable.');
      project = window.blankProject(root.name || 'Cloud Project');
      project.project_uuid = String(projectUuid);
      project.id = project.id || ('p_' + Math.random().toString(36).slice(2, 10));
      project.features = [];
    }

    project.name = root.name || project.name;
    project.schema_version = root.schema_version || project.schema_version || '1.1';
    project.survey_mode = root.survey_mode || project.survey_mode || 'BS5837';
    project.created_at = root.created_at || project.created_at;
    project.updated_at = root.updated_at || project.updated_at;
    const rootSchema = parseJsonField(root.schema_json, Array.isArray(root.schema) ? cloneJson(root.schema) : null);
    if (Array.isArray(rootSchema) && rootSchema.length) project.schema = rootSchema;
    const rootMeta = parseJsonField(root.project_meta_json, cloneJson(root.project_meta || {})) || {};
    project.project_meta = Object.assign({}, project.project_meta || {}, rootMeta, {
      project_name: root.name || project.name,
      project_uuid: String(projectUuid),
      cloud_enabled: true
    });
    const rootBoundary = parseJsonField(root.red_line_boundary_json, Object.prototype.hasOwnProperty.call(root, 'red_line_boundary') ? cloneJson(root.red_line_boundary) : project.red_line_boundary);
    const rootTopo = parseJsonField(root.topo_reference_json, Object.prototype.hasOwnProperty.call(root, 'topo_reference') ? cloneJson(root.topo_reference) : project.topo_reference);
    const rootContext = parseJsonField(root.context_features_json, Object.prototype.hasOwnProperty.call(root, 'context_features') ? cloneJson(root.context_features) : project.context_features);
    project.red_line_boundary = rootBoundary;
    project.topo_reference = rootTopo;
    project.context_features = rootContext;

    const uploadMap = readUploadMap(projectUuid);
    project.features = Array.isArray(project.features) ? project.features : [];

    featureSnap.forEach(docSnap => {
      const remote = docSnap.data() || {};
      const uuid = String(remote.feature_uuid || docSnap.id);
      const index = project.features.findIndex(feature => String(feature && feature.properties && feature.properties.feature_uuid || '') === uuid);
      if (remote.deleted) {
        if (index >= 0) project.features.splice(index, 1);
        return;
      }
      const incoming = remoteFeature(remote);
      if (!incoming || !incoming.properties) return;
      incoming.properties.photos = index >= 0 && Array.isArray(project.features[index].properties && project.features[index].properties.photos)
        ? project.features[index].properties.photos
        : [];
      if (index < 0 || remoteTime(remote) > featureTime(project.features[index])) {
        if (index < 0) project.features.push(incoming);
        else project.features[index] = incoming;
      }
      addSurveyorToRegistry(project, incoming.properties);
      uploadMap[uuid] = String(incoming.properties.updated_at || '');
    });

    writeUploadMap(projectUuid, uploadMap);
    if (typeof window.repairProjectSchema === 'function') window.repairProjectSchema(project);
    if (typeof window.putProjectDb === 'function') await window.putProjectDb(project);
    if (typeof window.refreshProjects === 'function') await window.refreshProjects(project.id);
    if (typeof window.afterProjectOpenedUi === 'function') window.afterProjectOpenedUi();
    ensureProjectListener(project);
    setStatus('Cloud project opened locally. It will continue to work without signal.', 'ok');
    renderState();
  }

  function projectChanged(project) {
    renderState();
    if (!project || !isProjectCloudEnabled(project)) {
      stopProjectListener();
      return;
    }
    const config = savedConfig();
    if (!config) {
      setStatus('This project is cloud-enabled, but this device has no Firebase connection yet.', 'warn');
      return;
    }
    connect(config, true).then(function (ok) {
      if (ok) {
        ensureProjectListener(project);
        scheduleSync(project);
      }
    });
  }

  function renderState() {
    const project = (typeof window.currentProject === 'function') ? window.currentProject() : null;
    const connected = !!(db && currentUser);
    const enabled = isProjectCloudEnabled(project);

    const enableBtn = el('cloudEnableProjectBtn');
    if (enableBtn) {
      enableBtn.disabled = !project;
      enableBtn.textContent = enabled ? 'Disable cloud for project' : 'Enable cloud for project';
    }

    const syncBtn = el('cloudSyncNowBtn');
    if (syncBtn) syncBtn.disabled = !project || !enabled;

    const browseBtn = el('cloudBrowseBtn');
    if (browseBtn) browseBtn.disabled = !connected;

    const connection = el('cloudConnectionSummary');
    if (connection) {
      const config = savedConfig();
      connection.textContent = connected
        ? 'Signed in: ' + currentUser.email + ' · ' + (config && config.projectId ? config.projectId : 'Firebase')
        : (config ? 'Firebase configured · verify and sign in to collaborate' : 'No Firebase configured');
    }

    if (project && enabled && connected && !currentUnsubscribe) ensureProjectListener(project);
  }

  function wireUi() {
    const input = el('firebaseConfigInput');
    const config = savedConfig();
    if (input && config) input.value = JSON.stringify(config, null, 2);

    const connectBtn = el('cloudConnectBtn');
    if (connectBtn) connectBtn.onclick = async function () {
      try {
        const parsed = validateConfig(parseConfigText(input ? input.value : ''));
        saveConfig(parsed);
        await connect(parsed, false);
      } catch (err) {
        setStatus(err.message || String(err), 'error');
      }
    };

    const forgetBtn = el('cloudForgetBtn');
    if (forgetBtn) forgetBtn.onclick = async function () {
      stopProjectListener();
      if (auth && api) await api.signOut(auth).catch(function () {});
      forgetConfig();
      app = auth = db = currentUser = null;
      if (input) input.value = '';
      setStatus('Cloud connection forgotten on this device. Local projects are unchanged.', 'ok');
      renderState();
    };

    const enableBtn = el('cloudEnableProjectBtn');
    if (enableBtn) enableBtn.onclick = async function () {
      const project = (typeof window.currentProject === 'function') ? window.currentProject() : null;
      if (isProjectCloudEnabled(project)) await disableCurrentProject();
      else await enableCurrentProject();
    };

    const syncBtn = el('cloudSyncNowBtn');
    if (syncBtn) syncBtn.onclick = function () {
      syncNow().catch(function (err) { setStatus('Cloud sync failed: ' + (err.message || err), 'error'); });
    };

    const browseBtn = el('cloudBrowseBtn');
    if (browseBtn) browseBtn.onclick = function () {
      listCloudProjects().catch(function (err) { setStatus('Could not load cloud projects: ' + (err.message || err), 'error'); });
    };

    renderState();

    if (config) {
      connect(config, true).then(function (ok) {
        if (ok) listCloudProjects();
      });
    } else {
      setStatus('Local-only mode. Connect Firebase only if you want cloud collaboration.', 'ok');
    }
  }

  window.BudLeafCloud = {
    connect: connect,
    scheduleSync: scheduleSync,
    syncNow: syncNow,
    projectChanged: projectChanged,
    noteFeatureDeleted: noteFeatureDeleted,
    listCloudProjects: listCloudProjects,
    openCloudProject: openCloudProject,
    renderState: renderState,
    firebaseContext: function () { return { api: api, auth: auth, db: db, user: currentUser, config: savedConfig() }; },
    disconnectAccount: function () {
      stopProjectListener();
      currentUser = null;
      db = null;
      renderState();
    },
    isConnected: function () { return !!(db && currentUser); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireUi);
  else wireUi();
})();
