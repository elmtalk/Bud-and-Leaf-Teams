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
    const a = Array.isArray(project.surveyors) ? project.surveyors : [];
    const b = project.project_meta && Array.isArray(project.project_meta.surveyors)
      ? project.project_meta.surveyors : [];
    const merged = [];
    const seen = new Set();

    a.concat(b).forEach(function (s) {
      const name = cleanSurveyorName(s && (s.name || s.surveyor_name));
      const code = cleanSurveyorCode(s && (s.code || s.surveyor_code));
      if (!code || seen.has(code)) return;
      seen.add(code);
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
    if (!key) return null;

    const saved = readJson(key, null);
    if (!saved || !saved.code) return null;

    const code = cleanSurveyorCode(saved.code);
    const name = cleanSurveyorName(saved.name);
    const registered = findSurveyorByCode(project, code);

    if (registered && registered.name.toLowerCase() !== name.toLowerCase()) {
      return null;
    }

    return {
      name: name || (registered && registered.name) || code,
      code: code
    };
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
  }

  function getLastSurveyor() {
    const saved = readJson(LAST_SURVEYOR_KEY, null);
    if (!saved) return null;
    const name = cleanSurveyorName(saved.name);
    const code = cleanSurveyorCode(saved.code);
    return name && code ? { name: name, code: code } : null;
  }

  function chooseSurveyor(project, forcePrompt) {
    if (!project) return null;

    ensureProjectIdentity(project);

    if (!forcePrompt) {
      const current = getCurrentSurveyor(project);
      if (current) return current;

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
    }

    const previous = getLastSurveyor();
    const name = cleanSurveyorName(
      prompt('Surveyor name for this Bud&Leaf Teams project:', previous ? previous.name : '') || ''
    );
    if (!name) return null;

    let suggested = previous && previous.name.toLowerCase() === name.toLowerCase()
      ? previous.code
      : suggestSurveyorCode(name);

    let code = cleanSurveyorCode(
      prompt('Surveyor initials/code (must be unique in this project):', suggested) || ''
    );
    if (!code) return null;

    while (true) {
      const collision = findSurveyorByCode(project, code);
      if (!collision || collision.name.toLowerCase() === name.toLowerCase()) break;

      code = cleanSurveyorCode(
        prompt(code + ' is already used by ' + collision.name + '. Enter a different code:', '') || ''
      );
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

  function nextCaptureId(project, type, code, reserved) {
    type = String(type || 'T').toUpperCase();
    code = cleanSurveyorCode(code);
    const prefix = code + type;
    let max = 0;

    function inspect(value) {
      const m = String(value || '').match(new RegExp('^' + prefix + '(\\d+)$', 'i'));
      if (m) max = Math.max(max, Number(m[1]) || 0);
    }

    (project && project.features || []).forEach(function (feature) {
      const props = feature.properties || {};
      inspect(props.capture_id || props.tree_id || '');
    });

    if (reserved) reserved.forEach(inspect);

    return prefix + (max + 1);
  }

  function ensureFeatureIdentity(project, feature, seenUuids, seenCaptureIds) {
    if (!project || !feature) return feature;

    feature.properties = feature.properties || {};
    const props = feature.properties;
    const type = String(props.feature_type || 'T').toUpperCase();

    let featureUuid = String(props.feature_uuid || feature.feature_uuid || '').trim();
    if (!featureUuid || (seenUuids && seenUuids.has(featureUuid))) {
      featureUuid = newUuid();
      props.created_at = nowIsoTeams();
    }

    props.feature_uuid = featureUuid;
    feature.feature_uuid = featureUuid;
    if (seenUuids) seenUuids.add(featureUuid);

    props.project_uuid = project.project_uuid;
    props.schema_version = TEAMS_SCHEMA_VERSION;

    let captureId = String(props.capture_id || '').trim();
    const treeId = String(props.tree_id || '').trim();

    if (!captureId && treeId) captureId = treeId;

    if (captureId && seenCaptureIds && seenCaptureIds.has(captureId)) {
      const surveyor = getCurrentSurveyor(project);
      if (surveyor) {
        captureId = nextCaptureId(project, type, surveyor.code, seenCaptureIds);
        props.feature_uuid = newUuid();
        feature.feature_uuid = props.feature_uuid;
        props.created_at = nowIsoTeams();
        props.surveyor_name = surveyor.name;
        props.surveyor_code = surveyor.code;
      }
    }

    if (captureId) {
      props.capture_id = captureId;
      if (seenCaptureIds) seenCaptureIds.add(captureId);
    }

    if (props.final_id === undefined || props.final_id === null) props.final_id = '';

    if (!props.final_id && treeId && /^[TGHW]\d+$/i.test(treeId)) {
      props.final_id = treeId.toUpperCase();
    }

    if (String(props.final_id || '').trim()) {
      props.tree_id = String(props.final_id).trim();
    } else if (String(props.capture_id || '').trim()) {
      props.tree_id = String(props.capture_id).trim();
    }

    if (!props.created_at) props.created_at = nowIsoTeams();
    props.updated_at = nowIsoTeams();

    return feature;
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

  function installTeamsIdentity() {
    if (window.__budLeafTeamsIdentityInstalled) return;
    window.__budLeafTeamsIdentityInstalled = true;

    const originalNextTreeId = window.nextTreeId;
    if (typeof originalNextTreeId === 'function') {
      window.nextTreeId = function (project, type) {
        project = project || (typeof window.currentProject === 'function' ? window.currentProject() : null);
        if (!project) return originalNextTreeId.apply(this, arguments);

        ensureProjectIdentity(project);
        const surveyor = getCurrentSurveyor(project) || chooseSurveyor(project, false);
        if (!surveyor) return originalNextTreeId.apply(this, arguments);

        return nextCaptureId(project, type, surveyor.code);
      };
    }

    const originalBuildDefaults = window.buildDefaults;
    if (typeof originalBuildDefaults === 'function') {
      window.buildDefaults = function (featureType, category, latlng, projectOverride) {
        const project = projectOverride ||
          (typeof window.currentProject === 'function' ? window.currentProject() : null);

        if (project) ensureProjectIdentity(project);

        const props = originalBuildDefaults.apply(this, arguments);
        if (!project) return props;

        const surveyor = getCurrentSurveyor(project) || chooseSurveyor(project, false);
        if (!surveyor) return props;

        props.feature_uuid = newUuid();
        props.project_uuid = project.project_uuid;
        props.schema_version = TEAMS_SCHEMA_VERSION;
        props.capture_id = props.tree_id || nextCaptureId(project, featureType, surveyor.code);
        props.final_id = '';
        props.surveyor_name = surveyor.name;
        props.surveyor_code = surveyor.code;
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
        return await originalSaveCurrentProject.apply(this, arguments);
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

    const originalPackage = window.currentBudProjectPackage;
    if (typeof originalPackage === 'function') {
      window.currentBudProjectPackage = function () {
        const project = typeof window.currentProject === 'function' ? window.currentProject() : null;
        if (project) ensureProjectIdentity(project);

        const payload = originalPackage.apply(this, arguments);
        if (!payload || !project) return payload;

        payload.app = 'Bud&Leaf Teams';
        payload.schema_version = TEAMS_SCHEMA_VERSION;
        payload.project_uuid = project.project_uuid;

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

    const originalImport = window.importDashboardPackageObject;
    if (typeof originalImport === 'function') {
      window.importDashboardPackageObject = async function (pkg) {
        const result = await originalImport.apply(this, arguments);
        const project = typeof window.currentProject === 'function' ? window.currentProject() : null;

        if (project) {
          const importedUuid =
            (pkg && pkg.project_uuid) ||
            (pkg && pkg.project_json && pkg.project_json.project && pkg.project_json.project.project_uuid) ||
            '';

          if (importedUuid) project.project_uuid = importedUuid;
          ensureProjectIdentity(project);

          if (typeof window.saveCurrentProject === 'function') {
            await window.saveCurrentProject(true);
          }
        }

        return result;
      };
    }

    const originalAfterProjectOpenedUi = window.afterProjectOpenedUi;
    if (typeof originalAfterProjectOpenedUi === 'function') {
      window.afterProjectOpenedUi = function () {
        const result = originalAfterProjectOpenedUi.apply(this, arguments);
        const project = typeof window.currentProject === 'function' ? window.currentProject() : null;
        if (project) ensureProjectIdentity(project);
        return result;
      };
    }

    // Prompt once per device/project before entering field survey.
    // This changes behaviour only, not layout.
    const startSurveyBtn = document.getElementById('setupStartSurveyBtn');
    if (startSurveyBtn && typeof startSurveyBtn.onclick === 'function') {
      const originalStartSurvey = startSurveyBtn.onclick;
      startSurveyBtn.onclick = function (event) {
        const project = typeof window.currentProject === 'function' ? window.currentProject() : null;
        if (project) {
          ensureProjectIdentity(project);
          if (!getCurrentSurveyor(project) && !chooseSurveyor(project, false)) return;
          if (typeof window.saveCurrentProject === 'function') window.saveCurrentProject(true);
        }
        return originalStartSurvey.call(this, event);
      };
    }

    const project = typeof window.currentProject === 'function' ? window.currentProject() : null;
    if (project) ensureProjectIdentity(project);

    window.BudLeafTeams = {
      schemaVersion: TEAMS_SCHEMA_VERSION,
      ensureProjectIdentity: ensureProjectIdentity,
      getCurrentSurveyor: getCurrentSurveyor,
      chooseSurveyor: function () {
        const p = typeof window.currentProject === 'function' ? window.currentProject() : null;
        return p ? chooseSurveyor(p, true) : null;
      },
      newUuid: newUuid
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(installTeamsIdentity, 0);
    });
  } else {
    setTimeout(installTeamsIdentity, 0);
  }
})();
