(function () {
  'use strict';

  const REGISTRY_KEY = 'teams_surveyors';
  const LOCAL_PREFIX = 'budleaf_teams_local_surveyor_';

  function cleanName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function cleanCode(value) {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 3);
  }

  function suggestCode(name) {
    const parts = cleanName(name).split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts.length ? parts[0].slice(0, 2).toUpperCase() : '';
  }

  function currentProjectSafe() {
    try {
      if (typeof window.currentProject === 'function') return window.currentProject();
    } catch (e) {}
    return null;
  }

  function projectKey(project) {
    if (!project) return '';
    return String(
      project.project_uuid ||
      project.id ||
      (project.project_meta && project.project_meta.project_name) ||
      project.name ||
      ''
    );
  }

  function getRegistry(project) {
    if (!project) return [];
    project.project_meta = project.project_meta || {};
    const raw = project.project_meta[REGISTRY_KEY];
    if (!Array.isArray(raw)) {
      project.project_meta[REGISTRY_KEY] = [];
      return project.project_meta[REGISTRY_KEY];
    }

    const cleaned = [];
    const seen = new Set();

    raw.forEach(function (entry) {
      const name = cleanName(entry && (entry.name || entry.surveyor_name));
      const code = cleanCode(entry && (entry.code || entry.surveyor_code));
      if (!name || code.length < 2 || seen.has(code)) return;
      seen.add(code);
      cleaned.push({ name: name, code: code });
    });

    project.project_meta[REGISTRY_KEY] = cleaned;
    return cleaned;
  }

  function localStorageKey(project) {
    const key = projectKey(project);
    return key ? LOCAL_PREFIX + key : '';
  }

  function getLocalSurveyor(project) {
    const key = localStorageKey(project);
    if (!key) return null;

    try {
      const raw = JSON.parse(localStorage.getItem(key) || 'null');
      if (!raw) return null;

      const name = cleanName(raw.name);
      const code = cleanCode(raw.code);
      if (!name || code.length < 2) return null;

      const registry = getRegistry(project);
      const registered = registry.find(function (entry) {
        return entry.code === code;
      });

      if (registered && registered.name.toLowerCase() !== name.toLowerCase()) {
        return null;
      }

      return { name: name, code: code };
    } catch (e) {
      return null;
    }
  }

  function setLocalSurveyor(project, surveyor) {
    const key = localStorageKey(project);
    if (!key) return;

    try {
      localStorage.setItem(key, JSON.stringify({
        name: surveyor.name,
        code: surveyor.code
      }));
    } catch (e) {}
  }

  function persistProject(project) {
    try {
      if (typeof window.saveCurrentProject === 'function') {
        Promise.resolve(window.saveCurrentProject(true)).catch(function (err) {
          console.warn('Bud&Leaf Teams: surveyor registration saved in memory but project save failed.', err);
        });
      }
    } catch (err) {
      console.warn('Bud&Leaf Teams: could not persist surveyor registration.', err);
    }
  }

  function registerSurveyor(project) {
    if (!project) return false;

    const existingLocal = getLocalSurveyor(project);
    if (existingLocal) return true;

    const registry = getRegistry(project);

    let name = cleanName(window.prompt('Surveyor name:', '') || '');
    if (!name) return false;

    let code = cleanCode(
      window.prompt(
        'Surveyor initials/code (2–3 letters, unique in this project):',
        suggestCode(name)
      ) || ''
    );

    while (true) {
      if (code.length < 2) {
        code = cleanCode(
          window.prompt('Please enter a 2–3 letter surveyor code:', code) || ''
        );
        if (!code) return false;
        continue;
      }

      const collision = registry.find(function (entry) {
        return entry.code === code;
      });

      if (!collision) break;

      if (collision.name.toLowerCase() === name.toLowerCase()) {
        setLocalSurveyor(project, collision);
        return true;
      }

      code = cleanCode(
        window.prompt(
          code + ' is already registered to ' + collision.name +
          '. Enter a different 2–3 letter code:',
          ''
        ) || ''
      );

      if (!code) return false;
    }

    const surveyor = { name: name, code: code };
    registry.push(surveyor);

    project.project_meta = project.project_meta || {};
    project.project_meta[REGISTRY_KEY] = registry;
    project.project_meta.teams_enabled = true;

    setLocalSurveyor(project, surveyor);
    persistProject(project);

    try {
      if (typeof window.showNotice === 'function') {
        window.showNotice('Surveyor registered: ' + name + ' (' + code + ').');
      }
    } catch (e) {}

    return true;
  }

  function needsSurveyorForClick(target) {
    if (!target) return false;
    const button = target.closest && target.closest('button');
    if (!button) return false;

    return button.id === 'setupStartSurveyBtn' ||
           button.id === 'setupOpenMapBtn' ||
           button.id === 'openProjectBtn' ||
           !!(button.dataset && button.dataset.projectOpen);
  }

  function onMapOpenCapture(event) {
    if (!needsSurveyorForClick(event.target)) return;

    const project = currentProjectSafe();
    if (!project) return;

    if (getLocalSurveyor(project)) return;

    const ok = registerSurveyor(project);
    if (!ok) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  document.addEventListener('click', onMapOpenCapture, true);

  window.BudLeafTeamsSurveyor = {
    getCurrent: function () {
      return getLocalSurveyor(currentProjectSafe());
    },
    register: function () {
      const project = currentProjectSafe();
      return project ? registerSurveyor(project) : false;
    },
    list: function () {
      const project = currentProjectSafe();
      return project ? getRegistry(project).slice() : [];
    }
  };
})();
