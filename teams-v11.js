(function () {
  'use strict';

  const TEAMS_SCHEMA_VERSION = '1.1';
  const CURRENT_SURVEYOR_PREFIX = 'budleaf_teams_current_surveyor_';
  const LAST_SURVEYOR_KEY = 'budleaf_teams_last_surveyor_v1';

  function nowIsoTeams() {
    return new Date().toISOString();
  }

  function newUuid() {
    try {
      if (self.crypto && typeof self.crypto.randomUUID === 'function') {
        return self.crypto.randomUUID();
      }
    } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function cleanSurveyorName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function cleanSurveyorCode(value) {
    return String(value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 3);
  }

  function suggestSurveyorCode(name) {
    const words = cleanSurveyorName(name).split(/\s+/).filter(Boolean);
    if (!words.length) return '';
    if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
    return words.map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase();
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function projectUuid(project) {
    if (!project) return '';
    return project.project_uuid ||
      (project.project_meta && project.project_meta.project_uuid) ||
      '';
  }

  function surveyorList(project) {
    if (!project) return [];
    const fromTop = Array.isArray(project.surveyors) ? project.surveyors : [];
    const fromMeta = project.project_meta && Array.isArray(project.project_meta.surveyors)
      ? project.project_meta.surveyors : [];
    const merged = [];
    const seen = new Set();

    fromTop.concat(fromMeta).forEach(function (s) {
      const name = cleanSurveyorName(s && (s.name || s.surveyor_name));
      const code = cleanSurveyorCode(s && (s.code || s.surveyor_code));
      if (!code) return;
      const key = code.toUpperCase();
      if (seen.has(key)) return;
      seen.add(key);
      merged.push({ name: name || code, code: code });
    });

    project.surveyors = merged.slice();
    project.project_meta = project.project_meta || {};
    project.project_meta.surveyors = merged.slice();
    return merged;
  }

  function findSurveyorByCode(project, code) {
    const target = cleanSurveyorCode(code);
    return surveyorList(project).find(function (s) {
      return s.code === target;
    }) || null;
  }

  function registerSurveyor(project, name, code) {
    name = cleanSurveyorName(name);
    code = cleanSurveyorCode(code);
    if (!project) throw new Error('No project selected.');
    if (!name) throw new Error('Enter the surveyor name.');
    if (!code) throw new Error('Enter surveyor initials/code.');

    const existing = findSurveyorByCode(project, code);
    if (existing && existing.name.toLowerCase() !== name.toLowerCase()) {
      throw new Error('Surveyor code ' + code + ' is already used by ' + existing.name + '. Choose a different code.');
    }

    if (!existing) {
      project.surveyors = surveyorList(project).concat([{ name: name, code: code }]);
    }
    project.project_meta = project.project_meta || {};
    project.project_meta.surveyors = project.surveyors.slice();
    return { name: name, code: code };
  }

  function currentSurveyorKey(project) {
    const id = projectUuid(project);
    return id ? CURRENT_SURVEYOR_PREFIX + id : '';
  }

  function getCurrentSurveyor(project) {
    if (!project) return null;
    const key = currentSurveyorKey(project);
    if (key) {
      const saved = readJson(key, null);
      if (saved && saved.code) {
        const code = cleanSurveyorCode(saved.code);
        const registered = findSurveyorByCode(project, code);
        if (!registered || registered.name.toLowerCase() === cleanSurveyorName(saved.name).toLowerCase()) {
          return { name: cleanSurveyorName(saved.name) || (registered && registered.name) || code, code: code };
        }
      }
    }
    return null;
  }

  function setCurrentSurveyor(project, surveyor) {
    if (!project || !surveyor) return;
    const clean = {
      name: cleanSurveyorName(surveyor.name),
      code: cleanSurveyorCode(surveyor.code)
    };
    const key = currentSurveyorKey(project);
    if (key) writeJson(key, clean);
    writeJson(LAST_SURVEYOR_KEY, clean);
    renderTeamsSurveyorStatus();
  }

  function getLastSurveyor() {
    const saved = readJson(LAST_SURVEYOR_KEY, null);
    if (!saved) return null;
    const name = cleanSurveyorName(saved.name);
    const code = cleanSurveyorCode(saved.code);
    return name && code ? { name: name, code: code } : null;
  }

  function ensureProjectIdentity(project) {
    if (!project) return project;

    project.project_meta = project.project_meta || {};

    if (!project.project_uuid) {
      project.project_uuid = project.project_meta.project_uuid || newUuid();
    }
    project.project_meta.project_uuid = project.project_uuid;
    project.schema_version = TEAMS_SCHEMA_VERSION;
    project.project_meta.schema_version = TEAMS_SCHEMA_VERSION;

    surveyorList(project);

    const seenUuids = new Set();
    const seenCaptureIds = new Set();

    (project.features || []).forEach(function (feature) {
      ensureFeatureIdentity(project, feature, seenUuids, seenCaptureIds);
    });

    return project;
  }

  function ensureFeatureIdentity(project, feature, seenUuids, seenCaptureIds) {
    if (!feature) return feature;
    feature.properties = feature.properties || {};
    const props = feature.properties;
    const type = String(props.feature_type || 'T').toUpperCase();

    let featureUuid = String(props.feature_uuid || feature.feature_uuid || '').trim();
    if (!featureUuid || (seenUuids && seenUuids.has(featureUuid))) {
      featureUuid = newUuid();
      props.created_at = nowIsoTeams();
      const cur = getCurrentSurveyor(project);
      if (cur) {
        props.surveyor_name = cur.name;
        props.surveyor_code = cur.code;
        props.created_by = cur.code;
      }
    }
    props.feature_uuid = featureUuid;
    feature.feature_uuid = featureUuid;
    if (seenUuids) seenUuids.add(featureUuid);

    props.project_uuid = project.project_uuid;
    props.schema_version = TEAMS_SCHEMA_VERSION;

    let captureId = String(props.capture_id || '').trim();
    let treeId = String(props.tree_id || '').trim();
    const finalId = String(props.final_id || '').trim();

    if (!captureId && treeId) captureId = treeId;

    if (captureId && seenCaptureIds && seenCaptureIds.has(captureId)) {
      // A copied feature must never inherit the source feature's field identity.
      const cur = getCurrentSurveyor(project);
      if (cur) captureId = nextCaptureId(project, type, cur.code, seenCaptureIds);
      else captureId = '';
      props.feature_uuid = newUuid();
      feature.feature_uuid = props.feature_uuid;
      props.created_at = nowIsoTeams();
      if (cur) {
        props.surveyor_name = cur.name;
        props.surveyor_code = cur.code;
        props.created_by = cur.code;
      }
    }

    if (captureId) {
      props.capture_id = captureId;
      if (seenCaptureIds) seenCaptureIds.add(captureId);
    }

    // Legacy single-surveyor IDs are already valid finished IDs.
    if (!props.final_id && treeId && /^[TGHW]\d+$/i.test(treeId) && !/^[A-Z0-9]{1,3}[TGHW]\d+$/i.test(treeId)) {
      props.final_id = treeId.toUpperCase();
    } else if (props.final_id === undefined || props.final_id === null) {
      props.final_id = '';
    }

    // During Teams capture, the visible tree_id is the capture ID.
    // Once ADM supplies a final_id, the final ID becomes the visible tree_id
    // while capture_id is retained permanently.
    if (String(props.final_id || '').trim()) {
      props.tree_id = String(props.final_id).trim();
    } else if (String(props.capture_id || '').trim()) {
      props.tree_id = String(props.capture_id).trim();
    }

    if (!props.created_at) props.created_at = nowIsoTeams();
    props.updated_at = nowIsoTeams();

    return feature;
  }

  function nextCaptureId(project, type, code, reserved) {
    type = String(type || 'T').toUpperCase();
    code = cleanSurveyorCode(code);
    const prefix = code + type;
    let max = 0;

    (project && project.features || []).forEach(function (feature) {
      const props = feature.properties || {};
      const value = String(props.capture_id || props.tree_id || '');
      const m = value.match(new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$', 'i'));
      if (m) max = Math.max(max, Number(m[1]) || 0);
    });

    if (reserved) {
      reserved.forEach(function (value) {
        const m = String(value || '').match(new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$', 'i'));
        if (m) max = Math.max(max, Number(m[1]) || 0);
      });
    }

    return prefix + (max + 1);
  }

  function promptForSurveyor(project) {
    if (!project) return null;

    ensureProjectIdentity(project);

    const existing = getCurrentSurveyor(project);
    if (existing) return existing;

    const last = getLastSurveyor();
    if (last) {
      const collision = findSurveyorByCode(project, last.code);
      if (!collision || collision.name.toLowerCase() === last.name.toLowerCase()) {
        try {
          const registered = registerSurveyor(project, last.name, last.code);
          setCurrentSurveyor(project, registered);
          return registered;
        } catch (e) {}
      }
    }

    const name = cleanSurveyorName(prompt('Surveyor name for this Bud&Leaf Teams project:', last ? last.name : '') || '');
    if (!name) return null;

    let suggested = last && last.name.toLowerCase() === name.toLowerCase()
      ? last.code
      : suggestSurveyorCode(name);

    let code = cleanSurveyorCode(prompt('Surveyor initials/code (must be unique in this project):', suggested) || '');
    if (!code) return null;

    while (true) {
      const collision = findSurveyorByCode(project, code);
      if (!collision || collision.name.toLowerCase() === name.toLowerCase()) break;
      code = cleanSurveyorCode(prompt(
        code + ' is already used by ' + collision.name + '. Enter a different surveyor code:',
        ''
      ) || '');
      if (!code) return null;
    }

    try {
      const surveyor = registerSurveyor(project, name, code);
      setCurrentSurveyor(project, surveyor);
      return surveyor;
    } catch (err) {
      alert(err.message || String(err));
      return null;
    }
  }

  function installSetupFields() {
    if (document.getElementById('teamsSurveyorName')) return;

    const surveyMode = document.getElementById('surveyModeSelect');
    if (!surveyMode) return;

    const block = document.createElement('div');
    block.id = 'teamsSurveyorFields';
    block.innerHTML =
      '<div style="height:14px"></div>' +
      '<label class="label">Surveyor name *</label>' +
      '<input id="teamsSurveyorName" class="input" type="text" placeholder="e.g. James Roberts" autocomplete="name" />' +
      '<div style="height:10px"></div>' +
      '<label class="label">Surveyor initials/code *</label>' +
      '<input id="teamsSurveyorCode" class="input" type="text" maxlength="3" placeholder="e.g. J or JR" autocapitalize="characters" />' +
      '<div class="clean-muted" style="margin-top:6px">Used for visible field IDs such as JT1 / JG1. The permanent UUID stays hidden.</div>';

    surveyMode.insertAdjacentElement('afterend', block);

    const nameInput = document.getElementById('teamsSurveyorName');
    const codeInput = document.getElementById('teamsSurveyorCode');

    nameInput.addEventListener('input', function () {
      if (!codeInput.value.trim()) codeInput.value = suggestSurveyorCode(nameInput.value);
    });

    codeInput.addEventListener('input', function () {
      const cleaned = cleanSurveyorCode(codeInput.value);
      if (codeInput.value !== cleaned) codeInput.value = cleaned;
    });
  }

  function fillSetupSurveyorFields(project) {
    installSetupFields();
    const nameInput = document.getElementById('teamsSurveyorName');
    const codeInput = document.getElementById('teamsSurveyorCode');
    if (!nameInput || !codeInput) return;

    let surveyor = project ? getCurrentSurveyor(project) : null;
    if (!surveyor) surveyor = getLastSurveyor();

    nameInput.value = surveyor ? surveyor.name : '';
    codeInput.value = surveyor ? surveyor.code : '';
  }

  function validateSetupSurveyorFields(project) {
    installSetupFields();
    const nameInput = document.getElementById('teamsSurveyorName');
    const codeInput = document.getElementById('teamsSurveyorCode');
    const name = cleanSurveyorName(nameInput && nameInput.value);
    const code = cleanSurveyorCode(codeInput && codeInput.value);

    if (!name) {
      alert('Enter the surveyor name.');
      if (nameInput) nameInput.focus();
      return null;
    }
    if (!code) {
      alert('Enter surveyor initials/code.');
      if (codeInput) codeInput.focus();
      return null;
    }

    if (project) {
      const collision = findSurveyorByCode(project, code);
      if (collision && collision.name.toLowerCase() !== name.toLowerCase()) {
        alert('Surveyor code ' + code + ' is already used by ' + collision.name + '. Choose another code.');
        if (codeInput) codeInput.focus();
        return null;
      }
    }
    return { name: name, code: code };
  }

  function installSurveyorStatus() {
    if (document.getElementById('teamsSurveyorStatus')) return;
    const statusBox = document.getElementById('setupStatusBox');
    if (!statusBox || !statusBox.parentNode) return;

    const el = document.createElement('div');
    el.id = 'teamsSurveyorStatus';
    el.className = 'setup-status';
    el.style.marginTop = '8px';
    el.innerHTML = 'Teams surveyor: not set';
    statusBox.insertAdjacentElement('afterend', el);

    el.addEventListener('click', function () {
      const project = typeof window.currentProject === 'function' ? window.currentProject() : null;
      if (!project) return;
      const key = currentSurveyorKey(project);
      if (key) {
        try { localStorage.removeItem(key); } catch (e) {}
      }
      const surveyor = promptForSurveyor(project);
      if (surveyor) {
        ensureProjectIdentity(project);
        if (typeof window.saveCurrentProject === 'function') window.saveCurrentProject(true);
        renderTeamsSurveyorStatus();
      }
    });
  }

  function renderTeamsSurveyorStatus() {
    installSurveyorStatus();
    const el = document.getElementById('teamsSurveyorStatus');
    if (!el) return;

    const project = typeof window.currentProject === 'function' ? window.currentProject() : null;
    if (!project) {
      el.textContent = 'Teams surveyor: no project selected';
      el.style.cursor = 'default';
      return;
    }

    ensureProjectIdentity(project);
    const surveyor = getCurrentSurveyor(project);
    if (surveyor) {
      el.textContent = 'Teams surveyor: ' + surveyor.name + ' (' + surveyor.code + ') · tap to change';
    } else {
      el.textContent = 'Teams surveyor: not set · tap to choose';
    }
    el.style.cursor = 'pointer';
  }

  function installTeamsWrappers() {
    if (window.__budLeafTeamsIdentityInstalled) return;
    window.__budLeafTeamsIdentityInstalled = true;

    installSetupFields();
    installSurveyorStatus();

    const originalNextTreeId = window.nextTreeId;
    window.nextTreeId = function (project, type) {
      project = project || (typeof window.currentProject === 'function' ? window.currentProject() : null);
      if (!project) return originalNextTreeId ? originalNextTreeId(project, type) : String(type || 'T') + '1';

      ensureProjectIdentity(project);
      const surveyor = getCurrentSurveyor(project) || promptForSurveyor(project);
      if (!surveyor) {
        alert('Bud&Leaf Teams needs a surveyor name/code before adding a feature.');
        return originalNextTreeId ? originalNextTreeId(project, type) : String(type || 'T') + '1';
      }
      return nextCaptureId(project, type, surveyor.code);
    };

    const originalBuildDefaults = window.buildDefaults;
    if (typeof originalBuildDefaults === 'function') {
      window.buildDefaults = function (featureType, category, latlng, projectOverride) {
        const project = projectOverride || (typeof window.currentProject === 'function' ? window.currentProject() : null);
        if (project) ensureProjectIdentity(project);

        const props = originalBuildDefaults.apply(this, arguments);
        if (!project) return props;

        const surveyor = getCurrentSurveyor(project) || promptForSurveyor(project);
        if (!surveyor) return props;

        props.feature_uuid = newUuid();
        props.project_uuid = project.project_uuid;
        props.schema_version = TEAMS_SCHEMA_VERSION;
        props.capture_id = props.tree_id || nextCaptureId(project, featureType, surveyor.code);
        props.final_id = '';
        props.surveyor_name = surveyor.name;
        props.surveyor_code = surveyor.code;
        props.created_by = surveyor.code;
        props.created_at = nowIsoTeams();
        props.updated_at = props.created_at;
        props.tree_id = props.capture_id;
        return props;
      };
    }

    const originalSaveCurrentProject = window.saveCurrentProject;
    if (typeof originalSaveCurrentProject === 'function') {
      window.saveCurrentProject = async function () {
        const project = typeof window.currentProject === 'function' ? window.currentProject() : null;
        if (project) ensureProjectIdentity(project);
        const result = await originalSaveCurrentProject.apply(this, arguments);
        renderTeamsSurveyorStatus();
        return result;
      };
    }

    const originalBudHeaders = window.budAllExportHeaders;
    if (typeof originalBudHeaders === 'function') {
      window.budAllExportHeaders = function (project) {
        const base = originalBudHeaders.apply(this, arguments) || [];
        const identity = [
          'schema_version',
          'project_uuid',
          'feature_uuid',
          'capture_id',
          'final_id',
          'surveyor_name',
          'surveyor_code',
          'created_at',
          'updated_at'
        ];
        return Array.from(new Set(identity.concat(base)));
      };
    }

    const originalBudFeatureExportProps = window.budFeatureExportProps;
    if (typeof originalBudFeatureExportProps === 'function') {
      window.budFeatureExportProps = function (feature, layerName) {
        const project = typeof window.currentProject === 'function' ? window.currentProject() : null;
        if (project && feature) {
          ensureProjectIdentity(project);
          ensureFeatureIdentity(project, feature);
        }
        return originalBudFeatureExportProps.apply(this, arguments);
      };
    }

    const originalCurrentBudProjectPackage = window.currentBudProjectPackage;
    if (typeof originalCurrentBudProjectPackage === 'function') {
      window.currentBudProjectPackage = function () {
        const project = typeof window.currentProject === 'function' ? window.currentProject() : null;
        if (project) ensureProjectIdentity(project);

        const payload = originalCurrentBudProjectPackage.apply(this, arguments);
        if (!payload || !project) return payload;

        payload.app = 'Bud&Leaf Teams';
        payload.schema_version = TEAMS_SCHEMA_VERSION;
        payload.project_uuid = project.project_uuid;
        payload.project_id = project.id;

        payload.project_json = payload.project_json || {};
        payload.project_json.package_version = TEAMS_SCHEMA_VERSION;
        payload.project_json.dashboard_version = TEAMS_SCHEMA_VERSION;
        payload.project_json.schema_version = TEAMS_SCHEMA_VERSION;
        payload.project_json.project = Object.assign({}, payload.project_json.project || {}, {
          project_uuid: project.project_uuid,
          schema_version: TEAMS_SCHEMA_VERSION,
          surveyors: surveyorList(project)
        });

        return payload;
      };
    }

    const originalImportDashboardPackageObject = window.importDashboardPackageObject;
    if (typeof originalImportDashboardPackageObject === 'function') {
      window.importDashboardPackageObject = async function (pkg) {
        const result = await originalImportDashboardPackageObject.apply(this, arguments);
        const project = typeof window.currentProject === 'function' ? window.currentProject() : null;
        if (project) {
          const importedUuid =
            (pkg && pkg.project_uuid) ||
            (pkg && pkg.project_json && pkg.project_json.project && pkg.project_json.project.project_uuid) ||
            '';
          if (importedUuid) project.project_uuid = importedUuid;
          ensureProjectIdentity(project);
          if (typeof window.saveCurrentProject === 'function') await window.saveCurrentProject(true);
        }
        renderTeamsSurveyorStatus();
        return result;
      };
    }

    const originalResetNewProjectDraft = window.resetNewProjectDraft;
    if (typeof originalResetNewProjectDraft === 'function') {
      window.resetNewProjectDraft = function () {
        const result = originalResetNewProjectDraft.apply(this, arguments);
        fillSetupSurveyorFields(null);
        return result;
      };
    }

    const originalEditCurrentProjectDetails = window.editCurrentProjectDetails;
    if (typeof originalEditCurrentProjectDetails === 'function') {
      window.editCurrentProjectDetails = function () {
        const result = originalEditCurrentProjectDetails.apply(this, arguments);
        const project = typeof window.currentProject === 'function' ? window.currentProject() : null;
        if (project) ensureProjectIdentity(project);
        fillSetupSurveyorFields(project);
        return result;
      };
      const editBtn = document.getElementById('editProjectDetailsBtn');
      if (editBtn) editBtn.onclick = window.editCurrentProjectDetails;
    }

    const originalCreateOrSelectSetupProject = window.createOrSelectSetupProject;
    if (typeof originalCreateOrSelectSetupProject === 'function') {
      window.createOrSelectSetupProject = async function () {
        const editingProject = typeof window.currentProject === 'function' ? window.currentProject() : null;
        const surveyorInput = validateSetupSurveyorFields(
          window.state && window.state.editingProjectDetailsId ? editingProject : null
        );
        if (!surveyorInput) return null;

        const project = await originalCreateOrSelectSetupProject.apply(this, arguments);
        if (!project) return null;

        ensureProjectIdentity(project);

        try {
          const surveyor = registerSurveyor(project, surveyorInput.name, surveyorInput.code);
          setCurrentSurveyor(project, surveyor);
        } catch (err) {
          alert(err.message || String(err));
          return project;
        }

        if (typeof window.saveCurrentProject === 'function') {
          await window.saveCurrentProject(true);
        }

        renderTeamsSurveyorStatus();
        return project;
      };

      const createBtn = document.getElementById('setupCreateProjectBtn');
      if (createBtn) createBtn.onclick = window.createOrSelectSetupProject;
    }

    // Require a surveyor before entering the field map from the main Teams workflow.
    const startSurveyBtn = document.getElementById('setupStartSurveyBtn');
    if (startSurveyBtn && startSurveyBtn.onclick) {
      const originalStart = startSurveyBtn.onclick;
      startSurveyBtn.onclick = function (event) {
        const project = typeof window.currentProject === 'function' ? window.currentProject() : null;
        if (project) {
          ensureProjectIdentity(project);
          if (!getCurrentSurveyor(project) && !promptForSurveyor(project)) return;
        }
        renderTeamsSurveyorStatus();
        return originalStart.call(this, event);
      };
    }

    const originalAfterProjectOpenedUi = window.afterProjectOpenedUi;
    if (typeof originalAfterProjectOpenedUi === 'function') {
      window.afterProjectOpenedUi = function () {
        const result = originalAfterProjectOpenedUi.apply(this, arguments);
        const project = typeof window.currentProject === 'function' ? window.currentProject() : null;
        if (project) ensureProjectIdentity(project);
        renderTeamsSurveyorStatus();
        return result;
      };
    }

    const existingProject = typeof window.currentProject === 'function' ? window.currentProject() : null;
    if (existingProject) ensureProjectIdentity(existingProject);

    fillSetupSurveyorFields(existingProject);
    renderTeamsSurveyorStatus();

    window.BudLeafTeams = {
      schemaVersion: TEAMS_SCHEMA_VERSION,
      ensureProjectIdentity: ensureProjectIdentity,
      getCurrentSurveyor: getCurrentSurveyor,
      chooseSurveyor: promptForSurveyor,
      newUuid: newUuid
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(installTeamsWrappers, 0);
    });
  } else {
    setTimeout(installTeamsWrappers, 0);
  }
})();
