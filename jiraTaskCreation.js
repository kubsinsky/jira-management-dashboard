// ── Create Issue (Jira Task Creation) ─────────────────────────────────────────
(function (global) {
  'use strict';

  let deps = null;

  function init(depsObj) {
    deps = depsObj;
  }

  function onIssueTypeChange(val) {
    const epicFt    = document.getElementById('ci-epic-fasttrack');
    const epicName  = document.getElementById('ci-epicname-field');
    const parentRow = document.getElementById('ci-parent-row');
    const isEpic    = val === 'Epic';
    if (epicFt)    epicFt.style.display    = isEpic ? '' : 'none';
    if (epicName)  epicName.style.display  = isEpic ? '' : 'none';
    if (parentRow) parentRow.style.display = isEpic ? 'none' : '';
  }

  let _ciDropdownsState = { project:false, assignee:false, priority:false, issuetype:false, sprint:false, team:false, parent:false };

  function closeAllCiDropdowns() {
    const keys = Object.keys(_ciDropdownsState);
    keys.forEach(k => {
      _ciDropdownsState[k] = false;
      const el = document.getElementById(`ci-${k}-panel`);
      if (el) el.style.display = 'none';
    });
  }

  function toggleCiDropdown(event, type) {
    if (event) event.stopPropagation();
    const wasOpen = _ciDropdownsState[type];
    closeAllCiDropdowns();
    _ciDropdownsState[type] = !wasOpen;

    const el = document.getElementById(`ci-${type}-panel`);
    if (el) el.style.display = _ciDropdownsState[type] ? 'block' : 'none';

    if (_ciDropdownsState[type] && ['project','assignee','team','parent'].includes(type)) {
      setTimeout(() => {
        const inp = document.getElementById(`ci-${type}-search`);
        if (inp) { inp.value = ''; inp.focus(); triggerCiLocalFilter(type, ''); }
      }, 20);
    }
  }

  function triggerCiLocalFilter(type, val) {
    if (type === 'project') filterCiProjectsList(val);
    if (type === 'assignee') filterCiAssigneesList(val);
    if (type === 'team') filterCiTeamsList(val);
    if (type === 'parent') searchCiParentTicketsLive(val);
  }

  function _renderCiProjectsItems(query) {
    const listEl = document.getElementById('ci-project-list');
    if (!listEl) return;
    const q = (query || '').toLowerCase().trim();
    const projects = deps.state.allProjects || [];
    const filtered = q ? projects.filter(p => p.key.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)) : [...projects];

    if (!filtered.length) { listEl.innerHTML = '<div style="padding:8px 12px; font-size:12px; color:var(--gray-400);">No projects found</div>'; return; }
    listEl.innerHTML = filtered.map(p => `
      <div class="status-inline-item" onclick="selectCiProject('${deps.escHtml(p.key)}','${deps.escHtml(p.key)} — ${deps.escHtml(p.name)}')" style="padding:7px 12px; cursor:pointer; display:flex; align-items:center; gap:8px;">
        <span style="font-family:monospace; font-weight:700; color:var(--blue); font-size:11px;">${deps.escHtml(p.key)}</span>
        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${deps.escHtml(p.name)}</span>
      </div>`).join('');
  }

  function selectCiProject(key, label) {
    document.getElementById('ci-project').value = key;
    document.getElementById('ci-project-btn').textContent = label;
    closeAllCiDropdowns();
    if (key) loadCreateComponents(key);
  }

  function filterCiProjectsList(v) { _renderCiProjectsItems(v); }

  async function loadCreateComponents(projKey) {
    const listEl = document.getElementById('ci-comp-list');
    if (!listEl) return;
    listEl.innerHTML = '<div style="padding:8px 12px; font-size:12px; color:var(--gray-400);">Loading project components…</div>';
    try {
      const data = await deps.apiGet(`project/${encodeURIComponent(projKey)}/components`);
      const comps = Array.isArray(data) ? data : [];
      deps.state._ciAvailableComponents = comps.sort((a, b) => a.name.localeCompare(b.name));
      _renderCiComponentsItems('');
    } catch(e) {
      listEl.innerHTML = '<div style="padding:8px 12px; font-size:12px; color:var(--red);">No components discovered for this project</div>';
    }
  }

  function _renderCiComponentsItems(query) {
    const listEl = document.getElementById('ci-comp-list');
    if (!listEl) return;
    const q = (query || '').toLowerCase().trim();
    const comps = deps.state._ciAvailableComponents || [];
    const filtered = q ? comps.filter(c => c.name.toLowerCase().includes(q)) : [...comps];

    const selectEl = document.getElementById('ci-components');
    const selectedNames = new Set(Array.from(selectEl.options).filter(o => o.selected).map(o => o.value));

    if (!filtered.length) {
      listEl.innerHTML = '<div style="padding:8px 12px; font-size:12px; color:var(--gray-400);">No components matched</div>';
      return;
    }

    listEl.innerHTML = filtered.map(c => {
      const on = selectedNames.has(c.name);
      return `
        <div class="status-inline-item" onclick="toggleCiComponentItem(event, '${deps.escHtml(c.name)}')" style="padding:7px 12px; cursor:pointer; display:flex; align-items:center; gap:8px; ${on ? 'background:var(--blue-light);' : ''}">
          <span class="people-check" style="width:14px; display:inline-block; font-weight:700;">${on ? '✓' : ''}</span>
          <span>${deps.escHtml(c.name)}</span>
        </div>`;
    }).join('');
  }

  function toggleCiComponentItem(event, name) {
    if (event) event.stopPropagation();
    const selectEl = document.getElementById('ci-components');

    let opt = Array.from(selectEl.options).find(o => o.value === name);
    if (!opt) {
      opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      selectEl.appendChild(opt);
    }
    opt.selected = !opt.selected;

    const wrapEl = document.getElementById('ci-comp-wrap');
    const selectedOptions = Array.from(selectEl.options).filter(o => o.selected);

    if (selectedOptions.length === 0) {
      wrapEl.innerHTML = '<span id="ci-comp-placeholder" style="font-size:13px; color:var(--gray-400);">Select components…</span>';
    } else {
      wrapEl.innerHTML = selectedOptions.map(o => `
        <span class="chip component" style="margin:2px 0; font-size:11px; padding:2px 6px;">${deps.escHtml(o.value)}</span>
      `).join('');
    }

    const searchVal = document.getElementById('ci-comp-search').value;
    _renderCiComponentsItems(searchVal);
  }

  function toggleCompDropdown(event) {
    if (event) event.stopPropagation();
    const dd = document.getElementById('ci-comp-dd');
    const wrap = document.getElementById('ci-comp-wrap');
    if (!dd) return;
    const isHidden = dd.style.display === 'none';

    closeAllCiDropdowns();

    dd.style.display = isHidden ? 'block' : 'none';
    if (wrap) wrap.style.borderColor = isHidden ? 'var(--blue)' : 'var(--border)';

    if (isHidden) {
      setTimeout(() => {
        const inp = document.getElementById('ci-comp-search');
        if (inp) { inp.value = ''; inp.focus(); _renderCiComponentsItems(''); }
      }, 20);
    }
  }

  function filterCompDropdown(val) {
    _renderCiComponentsItems(val);
  }

  function _renderCiAssigneesItems(query) {
    const listEl = document.getElementById('ci-assignee-list');
    if (!listEl) return;
    const q = (query || '').toLowerCase().trim();
    const base = [{ accountId: '', displayName: '— Unassigned —' }];
    if (deps.CFG.meUser) base.push({ accountId: deps.CFG.me, displayName: 'Me (' + deps.CFG.meUser.displayName + ')' });
    const users = (deps.state.projectUsers || []).filter(u => u.accountId !== deps.CFG.me);
    const fullList = base.concat(users);

    const filtered = q ? fullList.filter(u => u.displayName.toLowerCase().includes(q)) : fullList;
    if (!filtered.length) { listEl.innerHTML = '<div style="padding:8px 12px; font-size:12px; color:var(--gray-400);">No members found</div>'; return; }

    listEl.innerHTML = filtered.map(u => `
      <div class="status-inline-item" onclick="selectCiAssignee('${deps.escHtml(u.accountId)}','${deps.escHtml(u.displayName)}')" style="padding:7px 12px; cursor:pointer; display:flex; align-items:center; gap:8px;">
        ${u.accountId ? deps.avatarHtml(u) : ''}
        <span>${deps.escHtml(u.displayName)}</span>
      </div>`).join('');
  }

  function selectCiAssignee(id, label) {
    document.getElementById('ci-assignee').value = id;
    document.getElementById('ci-assignee-btn').textContent = label;
    closeAllCiDropdowns();
  }

  function filterCiAssigneesList(v) { _renderCiAssigneesItems(v); }

  function _renderCiPriorityItems() {
    const listEl = document.getElementById('ci-priority-list');
    if (!listEl) return;
    listEl.innerHTML = deps.PRIORITIES.map(p => `
      <div class="status-inline-item" onclick="selectCiPriority('${deps.escHtml(p.name)}','${p.dot} ${deps.escHtml(p.label)}')" style="padding:6px 14px; cursor:pointer;">
        <span class="badge ${p.cls}">${p.dot} ${p.label}</span>
      </div>`).join('');
  }

  function selectCiPriority(name, label) {
    document.getElementById('ci-priority').value = name;
    document.getElementById('ci-priority-btn').innerHTML = label;
    closeAllCiDropdowns();
  }

  function _renderCiIssueTypeItems() {
    const listEl = document.getElementById('ci-issuetype-list');
    if (!listEl) return;
    const types = ['Task', 'Story', 'Bug', 'Epic', 'Subtask'];
    listEl.innerHTML = types.map(t => `
      <div class="status-inline-item" onclick="selectCiIssueType('${t}')" style="padding:7px 14px; cursor:pointer; font-weight:500;">
        ${t}
      </div>`).join('');
  }

  function selectCiIssueType(type) {
    document.getElementById('ci-issuetype').value = type;
    document.getElementById('ci-issuetype-btn').textContent = type;
    closeAllCiDropdowns();
    onIssueTypeChange(type);
  }

  async function _renderCiSprintItems() {
    const listEl = document.getElementById('ci-sprint-list');
    if (!listEl) return;
    listEl.innerHTML = '<div style="padding:8px 14px; font-size:12px; color:var(--gray-400);">Loading sprints…</div>';

    let sprints = [{ id: '', name: '— No sprint —' }];
    if (deps.BOARD_ID) {
      try {
        const r = await fetch(`/agile/board/${deps.BOARD_ID}/sprint?state=active,future&maxResults=20`);
        if (r.ok) {
          const d = await r.json();
          const apiSprints = (d.values || []).map(s => ({ id: s.id, name: s.name + (s.state === 'active' ? ' ✦' : '') }));
          sprints = sprints.concat(apiSprints);
        }
      } catch(e) {}
    }

    listEl.innerHTML = sprints.map(s => `
      <div class="status-inline-item" onclick="selectCiSprint('${deps.escHtml(s.id)}','${deps.escHtml(s.name)}')" style="padding:7px 14px; cursor:pointer;">
        <span class="chip sprint" style="pointer-events:none; font-size:11px;">${deps.escHtml(s.name)}</span>
      </div>`).join('');
  }

  function selectCiSprint(id, label) {
    document.getElementById('ci-sprint').value = id;
    document.getElementById('ci-sprint-btn').textContent = label;
    closeAllCiDropdowns();
  }

  function _renderCiTeamsItems(query) {
    const listEl = document.getElementById('ci-team-list');
    if (!listEl) return;
    const q = (query || '').toLowerCase().trim();
    const base = [{ id: '', name: '— No team —' }];
    const teams = deps.state.allTeams || [];
    const fullList = base.concat(teams);

    const filtered = q ? fullList.filter(t => t.name.toLowerCase().includes(q)) : fullList;
    if (!filtered.length) { listEl.innerHTML = '<div style="padding:8px 12px; font-size:12px; color:var(--gray-400);">No teams found</div>'; return; }

    listEl.innerHTML = filtered.map(t => `
      <div class="status-inline-item" onclick="selectCiTeam('${deps.escHtml(t.id)}','${deps.escHtml(t.name)}')" style="padding:7px 14px; cursor:pointer; font-size:12.5px;">
        ${deps.escHtml(t.name)}
      </div>`).join('');
  }

  function selectCiTeam(id, label) {
    document.getElementById('ci-team').value = id;
    document.getElementById('ci-team-btn').textContent = label;
    closeAllCiDropdowns();
  }

  function filterCiTeamsList(v) { _renderCiTeamsItems(v); }

  let _ciParentSearchTimer = null;
  function searchCiParentTicketsLive(query) {
    const listEl = document.getElementById('ci-parent-list');
    if (!listEl) return;
    const q = query.trim();

    let fallbackHtml = `<div class="status-inline-item" onclick="selectCiParent('', '— Independent Task / No Parent —')" style="padding:8px 12px; color:var(--gray-400); cursor:pointer;">— Independent Task / No Parent —</div>`;
    if (!q) {
      listEl.innerHTML = fallbackHtml + '<div style="padding:8px 12px; font-size:11px; color:var(--gray-400);">Type key or title to search live…</div>';
      return;
    }

    listEl.innerHTML = fallbackHtml + '<div style="padding:8px 12px; font-size:11px; color:var(--gray-400);">Searching issues…</div>';
    clearTimeout(_ciParentSearchTimer);
    _ciParentSearchTimer = setTimeout(async () => {
      try {
        const jql = `summary ~ "${q.replace(/"/g,'')}" OR key = "${q.toUpperCase()}" ORDER BY updated DESC`;
        const res = await deps.apiPost('search/jql', { jql, fields: ['summary','issuetype'], maxResults: 15 });
        const issues = res.issues || [];

        if (!issues.length) {
          listEl.innerHTML = fallbackHtml + '<div style="padding:8px 12px; font-size:11px; color:var(--gray-400);">No matching tickets found</div>';
          return;
        }

        const rowsHtml = issues.map(i => {
          const fullLabel = `${i.key} — ${i.fields.summary}`;
          return `
            <div class="status-inline-item" onclick="selectCiParent('${deps.escHtml(i.key)}','${deps.escHtml(fullLabel)}')" style="padding:8px 12px; cursor:pointer; display:flex; align-items:center; gap:6px;">
              <span style="font-weight:700; color:var(--blue); font-size:11.5px; font-family:monospace; flex-shrink:0;">${deps.escHtml(i.key)}</span>
              <span style="font-size:12px; color:var(--gray-700); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${deps.escHtml(i.fields.summary)}</span>
            </div>`;
        }).join('');

        listEl.innerHTML = fallbackHtml + rowsHtml;
      } catch(e) {
        listEl.innerHTML = fallbackHtml + `<div style="padding:8px 12px; font-size:11px; color:var(--red);">Error: ${deps.escHtml(e.message)}</div>`;
      }
    }, 250);
  }

  function selectCiParent(key, label) {
    document.getElementById('ci-parent-key').value = key;
    document.getElementById('ci-parent-btn').textContent = label.length > 55 ? label.slice(0, 55) + '…' : label;
    closeAllCiDropdowns();
  }

  async function openCreateModal(options = {}) {
    document.getElementById('ci-summary').value = '';
    document.getElementById('ci-description').value = '';
    document.getElementById('ci-duedate').value = '';
    document.getElementById('ci-epicname').value = '';
    document.getElementById('ci-fasttrack-tasks').value = '';

    document.getElementById('ci-project').value = '';
    document.getElementById('ci-project-btn').textContent = 'Select project…';
    document.getElementById('ci-assignee').value = deps.CFG.me || '';
    document.getElementById('ci-assignee-btn').textContent = deps.CFG.meUser ? deps.CFG.meUser.displayName : 'Me';
    document.getElementById('ci-priority').value = 'Normal';
    document.getElementById('ci-priority-btn').innerHTML = '● Normal';
    document.getElementById('ci-issuetype').value = 'Task';
    document.getElementById('ci-issuetype-btn').textContent = 'Task';
    document.getElementById('ci-sprint').value = '';
    document.getElementById('ci-sprint-btn').textContent = '— No sprint —';
    document.getElementById('ci-team').value = '';
    document.getElementById('ci-team-btn').textContent = '— No team —';
    document.getElementById('ci-parent-key').value = '';
    document.getElementById('ci-parent-btn').textContent = '— Independent Task / No Parent —';

    const issueType = options.issueType || 'Task';
    document.getElementById('ci-issuetype').value = issueType;
    document.getElementById('ci-issuetype-btn').textContent = issueType;
    onIssueTypeChange(issueType);
    closeAllCiDropdowns();

    const wrapEl = document.getElementById('ci-comp-wrap');
    if (wrapEl) wrapEl.innerHTML = '<span id="ci-comp-placeholder" style="font-size:13px; color:var(--gray-400);">Select components…</span>';
    const ddEl = document.getElementById('ci-comp-dd');
    if (ddEl) ddEl.style.display = 'none';
    const selectEl = document.getElementById('ci-components');
    if (selectEl) selectEl.innerHTML = '';
    deps.state._ciAvailableComponents = [];

    await deps.loadAllProjects();
    _renderCiProjectsItems('');
    _renderCiAssigneesItems('');
    _renderCiPriorityItems();
    _renderCiIssueTypeItems();
    _renderCiSprintItems();
    deps.loadAllTeams().then(() => _renderCiTeamsItems(''));

    const defKey = deps.state.defaultProjectKey || '';
    if (defKey && Array.from(deps.state.allProjects || []).some(p => p.key === defKey)) {
      const pObj = deps.state.allProjects.find(p => p.key === defKey);
      selectCiProject(defKey, `${pObj.key} — ${pObj.name}`);
    }

    if (options.parentKey) {
      document.getElementById('ci-parent-key').value = options.parentKey;
      document.getElementById('ci-parent-btn').textContent = options.parentKey;
    }

    document.getElementById('create-modal').classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('ci-summary').focus(), 50);
  }

  function closeCreateModal() {
    document.getElementById('create-modal').classList.remove('open');
    document.body.style.overflow = '';
  }

  function addSubtask(parentKey) {
    openCreateModal({ parentKey, issueType: 'Subtask' });
  }

  async function submitCreateIssue() {
    const submitBtn = document.getElementById('ci-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating…';

    const projKey = document.getElementById('ci-project').value;
    const summary = document.getElementById('ci-summary').value;
    const desc = document.getElementById('ci-description').value;
    const assignee = document.getElementById('ci-assignee').value;
    const priority = document.getElementById('ci-priority').value;
    const issueType = document.getElementById('ci-issuetype').value;
    const duedate = document.getElementById('ci-duedate').value;
    const sprintId = document.getElementById('ci-sprint').value;
    const teamId = document.getElementById('ci-team').value;
    const parentKey = document.getElementById('ci-parent-key').value;
    const epicName = document.getElementById('ci-epicname').value;
    const fasttrack = document.getElementById('ci-fasttrack-tasks').value;

    const isStickyMode = document.getElementById('ci-sticky-mode').checked;

    if (!projKey || !summary) {
      alert('Project and Summary are required fields.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Issue';
      return;
    }

    const compSel = Array.from(document.getElementById('ci-components').options)
      .filter(o => o.selected).map(o => ({ name: o.value }));

    const fields = {
      project: { key: projKey },
      summary: summary,
      description: deps.textToADF(desc),
      issuetype: { name: issueType },
      priority: { name: priority }
    };

    if (assignee) fields.assignee = { accountId: assignee };
    if (duedate) fields.duedate = duedate;
    if (compSel.length) fields.components = compSel;

    if (deps.CFG.teamField && teamId) fields[deps.CFG.teamField] = teamId;
    if (deps.CFG.sprintField && sprintId) fields[deps.CFG.sprintField] = parseInt(sprintId, 10);

    if (issueType === 'Epic' && epicName) {
      if (deps.CFG.epicNameField) fields[deps.CFG.epicNameField] = epicName;
    } else if (parentKey) {
      if (issueType === 'Subtask') {
        fields.parent = { key: parentKey };
      } else {
        if (deps.CFG.epicLinkField) fields[deps.CFG.epicLinkField] = parentKey;
        else fields.parent = { key: parentKey };
      }
    }

    try {
      const res = await deps.apiPost('issue', { fields });

      if (res && res.key && ((sprintId && deps.CFG.sprintField) || (teamId && deps.CFG.teamField))) {
        const updateFields = {};
        if (sprintId && deps.CFG.sprintField) updateFields[deps.CFG.sprintField] = parseInt(sprintId, 10);
        if (teamId && deps.CFG.teamField) updateFields[deps.CFG.teamField] = teamId;

        await deps.apiPut(`issue/${res.key}`, { fields: updateFields }).catch(err =>
          console.error("Błąd wymuszenia zapisu pól Agile:", err)
        );
      }

      if (issueType === 'Epic' && res && res.key && fasttrack.trim()) {
        const lines = fasttrack.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        for (const line of lines) {
          const childFields = {
            project: { key: projKey },
            summary: line,
            issuetype: { name: 'Task' },
            parent: { key: res.key }
          };
          if (sprintId && deps.CFG.sprintField) childFields[deps.CFG.sprintField] = parseInt(sprintId, 10);
          if (teamId && deps.CFG.teamField) childFields[deps.CFG.teamField] = teamId;
          await deps.apiPost('issue', { fields: childFields });
        }
      }

      deps.loadAll();

      if (isStickyMode) {
        document.getElementById('ci-summary').value = '';
        document.getElementById('ci-description').value = '';
        document.getElementById('ci-epicname').value = '';
        document.getElementById('ci-fasttrack-tasks').value = '';

        onIssueTypeChange(issueType);

        document.getElementById('ci-summary').focus();
      } else {
        closeCreateModal();
      }
    } catch(err) {
      alert('Failed to create issue: ' + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Issue';
    }
  }

  global.JiraTaskCreation = { init };
  global.openCreateModal = openCreateModal;
  global.closeCreateModal = closeCreateModal;
  global.submitCreateIssue = submitCreateIssue;
  global.addSubtask = addSubtask;
  global.toggleCiDropdown = toggleCiDropdown;
  global.filterCiProjectsList = filterCiProjectsList;
  global.filterCiAssigneesList = filterCiAssigneesList;
  global.filterCiTeamsList = filterCiTeamsList;
  global.searchCiParentTicketsLive = searchCiParentTicketsLive;
  global.selectCiParent = selectCiParent;
  global.selectCiProject = selectCiProject;
  global.selectCiAssignee = selectCiAssignee;
  global.selectCiPriority = selectCiPriority;
  global.selectCiIssueType = selectCiIssueType;
  global.selectCiSprint = selectCiSprint;
  global.selectCiTeam = selectCiTeam;
  global.toggleCiComponentItem = toggleCiComponentItem;
  global.toggleCompDropdown = toggleCompDropdown;
  global.filterCompDropdown = filterCompDropdown;

})(window);
