// ── Notifications ─────────────────────────────────────────────────────────────
function playNotifSound() {
  if (!state.soundEnabled) return;
  try {
    const audio = new Audio('/notif.mp3');
    audio.volume = 0.6;
    audio.play().catch(() => {});
  } catch {}
}

function toggleNotifSound(enabled) {
  state.soundEnabled = enabled;
  localStorage.setItem('notifSound', enabled ? 'true' : 'false');
  if (enabled) playNotifSound(); // preview the sound when turning on
}

async function silentRefresh() {
  const icon = document.getElementById('refresh-icon');
  if (icon) icon.style.animation = 'spin 1s linear infinite';
  try {
    const prevUnread = state.notifUnread;
    // OPTYMALIZACJA RATE LIMIT: Usunięto loadInbox() z cyklu tła, drastycznie zmniejszając liczbę żądań do Jiry
    await Promise.all([loadMyTasks(), loadMyTasksDone(), loadOversight(), loadNotifications()]);
    updateAllIssuesCache();
    renderWeekStrip();
    if (state.notifUnread > prevUnread) playNotifSound();
    const now = new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    const el = document.getElementById('last-refreshed');
    if (el) el.textContent = `Updated ${now}`;
  } finally {
    if (icon) icon.style.animation = '';
  }
}

let _pollTimer = null;
// null = first load (don't notify yet), Set = known keys from previous polls
let _knownNotifKeys = null;
function startPolling() {
  if (_pollTimer) return;
  _pollTimer = setInterval(silentRefresh, 3 * 60 * 1000); // every 3 minutes
}

async function loadNotifications() {
  if (!CFG.me) return;
  try {
    const fields = ['summary', 'status', 'updated', 'priority', 'assignee', 'reporter', 'project', 'comment', 'description', 'parent', 'resolution', 'issuelinks'];
    const jqlAssigned  = `assignee = "${CFG.me}" AND (updated >= -30d OR created >= -30d) ORDER BY updated DESC`;
    const jqlCreated   = `reporter = "${CFG.me}" AND assignee != "${CFG.me}" AND updated >= -30d ORDER BY updated DESC`;
    const jqlMentions  = `text ~ "${CFG.me}" AND updated >= -30d ORDER BY updated DESC`;

    const post = (jql, max) => fetch(`${CFG.apiBase}/search/jql`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql, fields, maxResults: max, expand: 'changelog' }),
    });

    const [r1, r2, r3] = await Promise.all([post(jqlAssigned, 50), post(jqlCreated, 50), post(jqlMentions, 30)]);

    const assigned = r1.ok ? (await r1.json()).issues || [] : [];
    const created  = r2.ok ? (await r2.json()).issues || [] : [];
    const mentions = r3.ok ? (await r3.json()).issues || [] : [];

    // Oznaczamy typ powiadomienia na obiekcie biletów
    assigned.forEach(i => { i._notifType = 'assigned'; });
    created.forEach(i => { i._notifType = 'created'; });
    mentions.forEach(i => { i._notifType = 'mention'; });

    // Scalamy wszystko w jeden strumień, usuwając duplikaty i parsując Changelog w tle
    const mergedMap = new Map();
    [...created, ...assigned, ...mentions].forEach(i => {
      let changeDescription = '';
      let actor = i._notifType === 'created' ? i.fields.assignee : i.fields.reporter;

      // Audyt ostatniej mutacji w historii zgloszenia (Smart Enterprise Core)
      let statusChange = null;
      let duedateChange = null;
      if (i.changelog && Array.isArray(i.changelog.histories) && i.changelog.histories.length > 0) {
        let targetHistory = null;
        for (let hIdx = i.changelog.histories.length - 1; hIdx >= 0; hIdx--) {
          const h = i.changelog.histories[hIdx];
          if (h && Array.isArray(h.items)) {
            const hasCoreField = h.items.some(item => {
              const fLower = (item.field || '').toLowerCase();
              return ['status', 'assignee', 'summary', 'description', 'priority', 'duedate', 'sprint', 'comment'].includes(fLower);
            });
            if (hasCoreField) {
              targetHistory = h;
              break;
            }
          }
        }

        const latest = targetHistory || i.changelog.histories[i.changelog.histories.length - 1];
        if (latest) {
          if (latest.author) actor = latest.author;

          // FILTROWANIE WŁASNYCH AKCJI
          if (actor && (actor.accountId === CFG.me || actor.key === CFG.me)) {
            return; // Nie dodawaj do mergedMap, jeśli to moja akcja
          }

          // Jeśli ostatnia zmiana to komentarz, to jest to wzmianka.
          const isComment = latest.items.some(item => (item.field || '').toLowerCase() === 'comment');
          if (isComment) {
            i._notifType = 'mention';
          }

          if (Array.isArray(latest.items) && latest.items.length > 0) {
            latest.items.forEach(item => {
              const fLower = (item.field || '').toLowerCase();
              const fromStr = item.fromString ? item.fromString.trim() : '';
              const toStr = item.toString ? item.toString.trim() : '';
              if (fLower === 'status' && fromStr !== toStr) statusChange = { from: fromStr, to: toStr };
              if (fLower === 'duedate' && fromStr !== toStr) duedateChange = { from: fromStr || 'None', to: toStr || 'None' };
            });

            changeDescription = latest.items.map(item => {
              // Jeśli zmiana dotyczy opisu, użyj prostego komunikatu
              if ((item.field || '').toLowerCase() === 'description') {
                return "Description updated";
              }
              const fName = item.field ? item.field.charAt(0).toUpperCase() + item.field.slice(1) : 'Field';
              const fromStr = item.fromString ? item.fromString.trim() : '';
              const toStr = item.toString ? item.toString.trim() : '';
              if (fromStr && toStr && fromStr !== toStr) return fName + ': ' + fromStr + ' -> ' + toStr;
              else if (toStr) return fName + ': ' + toStr;
              return 'Updated ' + fName;
            }).join(' | ');
          }
        }
      }

      if (!changeDescription) {
        if (i._notifType === 'mention') changeDescription = 'Added a comment';
        else if (i._notifType === 'created') changeDescription = 'Created / assigned this issue';
        else changeDescription = 'Modified ticket details';
      }

      i._notifActor = actor;
      i._notifChangeDesc = changeDescription;
      i._notifStatusChange = statusChange;
      i._notifDuedateChange = duedateChange;

      mergedMap.set(i.key, i);
    });

    state.allNotificationsRaw = Array.from(mergedMap.values());

    // Obliczamy stan nieprzeczytanych na podstawie klucza kompozytowego (Klucz + Data Modyfikacji)
    state.notifUnread = state.allNotificationsRaw.filter(i => {
      const compositeKey = i.key + '_' + (i.fields?.updated || '');
      return !state.notifReadKeys.has(compositeKey);
    }).length;

    renderNotifBadge();
    _checkForNewNotifications(state.allNotificationsRaw);
  } catch (err) { console.error(err); }
}

function _checkForNewNotifications(issues) {
  if (!window.electronAPI) return;

  if (_knownNotifKeys === null) {
    _knownNotifKeys = new Set(issues.map(i => i.key + '_' + (i.fields?.updated || '')));

    // Ciche powiadomienie systemowe na start aplikacji
    window.electronAPI.showNotification({
      title: 'Jira Notifications',
      body: 'Sync connected. Listening for updates...',
      silent: true
    });
    return;
  }

  let sent = 0;
  for (const issue of issues) {
    if (sent >= 3) break;
    const compositeKey = issue.key + '_' + (issue.fields?.updated || '');

    if (_knownNotifKeys.has(compositeKey)) continue;
    _knownNotifKeys.add(compositeKey);

    if (issue.fields?.updatedBy?.accountId === CFG.me) continue;

    let prefix = '🎯 Assigned';
    if (issue._notifType === 'mention') prefix = '💬 Mentioned';
    if (issue._notifType === 'created') prefix = '💼 Team Update';

    const statusName = (issue.fields?.status?.name || '').toLowerCase();
    if (statusName.includes('block') || statusName.includes('hold')) {
      prefix = '🔥 BLOCKER / HOLD';
    }

    window.electronAPI.showNotification({
      title: `${prefix}: ${issue.key}`,
      body: (issue.fields.summary || '').slice(0, 120),
      key: issue.key,
      updated: issue.fields?.updated
    });
    sent++;
  }

  if (_knownNotifKeys.size > 500) {
    const arr = [..._knownNotifKeys];
    _knownNotifKeys = new Set(arr.slice(arr.length - 500));
  }
}

function renderNotifBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  const count = state.notifUnread || 0;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
  // Sync to macOS dock badge / taskbar badge
  if (window.electronAPI && window.electronAPI.setBadgeCount) {
    window.electronAPI.setBadgeCount(count);
  }
}

function toggleNotifPanel(event) {
  event.stopPropagation();
  state.notifOpen = !state.notifOpen;
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  if (state.notifOpen) {
    panel.innerHTML = renderNotifContent();
    panel.classList.add('open');
  } else {
    panel.classList.remove('open');
  }
}

function closeNotifPanel() {
  state.notifOpen = false;
  const p = document.getElementById('notif-panel');
  if (p) p.classList.remove('open');
}

function _saveReadKeys() {
  localStorage.setItem('notifReadKeys', JSON.stringify([...state.notifReadKeys]));
}

function markOneRead(key, updatedTimestamp, event) {
  if (event) event.stopPropagation();
  const compositeKey = key + '_' + (updatedTimestamp || '');
  state.notifReadKeys.add(compositeKey);
  _saveReadKeys();

  state.notifUnread = Math.max(0, state.notifUnread - 1);
  renderNotifBadge();

  const el = document.getElementById(`ni-${key}`);
  if (el) {
    el.classList.remove('unread');
    const btn = el.querySelector('.notif-dismiss');
    if (btn) btn.style.display = 'none';
  }
}

function markAllNotifsRead() {
  const items = state.allNotificationsRaw || [];
  items.forEach(i => {
    const compositeKey = i.key + '_' + (i.fields?.updated || '');
    state.notifReadKeys.add(compositeKey);
  });
  _saveReadKeys();
  state.notifUnread = 0;
  renderNotifBadge();
  const panel = document.getElementById('notif-panel');
  if (panel && state.notifOpen) panel.innerHTML = renderNotifContent();
}

function renderNotifContent() {
  const items = state.allNotificationsRaw || [];

  const getJiraColor = (statusName) => {
    const name = (statusName || '').toLowerCase();
    if (name.includes('progress') || name.includes('review') || name.includes('test') || name.includes('qa') || name.includes('active') || name.includes('build')) return { bg: '#DEEBFF', text: '#0052CC' };
    if (name.includes('done') || name.includes('closed') || name.includes('resolved') || name.includes('ready') || name.includes('approved')) return { bg: '#E3FCEF', text: '#006644' };
    return { bg: '#DFE1E6', text: '#42526E' };
  };

  const sortedItems = [...items].sort((a, b) => {
    const dateA = a.fields && a.fields.updated ? a.fields.updated : '';
    const dateB = b.fields && b.fields.updated ? b.fields.updated : '';
    return dateB.localeCompare(dateA);
  });

  const makeItem = (i) => {
    const compositeKey = i.key + '_' + (i.fields && i.fields.updated ? i.fields.updated : '');
    const isUnread = !state.notifReadKeys.has(compositeKey);
    let si = statusInfo(i.fields.status);

    if (i.fields.resolution && (si.cat === 'done' || si.label.toLowerCase().includes('done'))) {
      si.label += ` (${i.fields.resolution.name})`;
    }

    const projName = i.fields.project && i.fields.project.name ? i.fields.project.name : '';
    let parentHtml = '';
    if (i.fields.parent) {
      parentHtml = `<div style="font-size:11px; color:var(--gray-500); margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escHtml(i.fields.parent.fields.summary)}">↳ Epic: ${escHtml(i.fields.parent.key)} ${escHtml(i.fields.parent.fields.summary)}</div>`;
    }

    let detailBadgesHtml = '';
    const changeDesc = i._notifChangeDesc || 'Updated issue details';

    if (i._notifType === 'assigned') detailBadgesHtml += '<div style="display:inline-flex; align-items:center; font-size:11px; margin-top:6px; font-weight:600; background:var(--gray-50); border:1px solid var(--gray-100); padding:2px 6px; border-radius:4px; margin-right:6px; color:var(--gray-700);">Assigned to Me</div>';
    else if (i._notifType === 'mention') detailBadgesHtml += '<div style="display:inline-flex; align-items:center; font-size:11px; margin-top:6px; font-weight:600; background:var(--gray-50); border:1px solid var(--gray-100); padding:2px 6px; border-radius:4px; margin-right:6px; color:var(--gray-700);">Mentioned</div>';

    if (i._notifStatusChange) {
      const fromC = getJiraColor(i._notifStatusChange.from);
      const toC = getJiraColor(i._notifStatusChange.to);
      detailBadgesHtml += '<div style="display:inline-flex; align-items:center; gap:4px; font-size:11px; margin-top:6px; font-weight:600; background:var(--gray-50); border:1px solid var(--gray-100); padding:2px 6px; border-radius:4px; margin-right:6px;"><span style="color:var(--gray-500);">Status:</span><span style="background:' + fromC.bg + '; color:' + fromC.text + '; padding:1px 4px; border-radius:3px; font-size:10px;">' + escHtml(i._notifStatusChange.from) + '</span><span style="color:var(--gray-400);">→</span><span style="background:' + toC.bg + '; color:' + toC.text + '; padding:1px 4px; border-radius:3px; font-size:10px;">' + escHtml(i._notifStatusChange.to) + '</span></div>';
    } else if (i._notifDuedateChange) {
      detailBadgesHtml += '<div style="display:inline-flex; align-items:center; gap:4px; font-size:11px; margin-top:6px; font-weight:600; background:var(--gray-50); border:1px solid var(--gray-100); padding:2px 6px; border-radius:4px; margin-right:6px;"><span style="color:var(--gray-500);">📅 Due:</span><span style="color:var(--gray-700);">' + escHtml(i._notifDuedateChange.from) + '</span><span style="color:var(--gray-400);">→</span><span style="color:var(--gray-700);">' + escHtml(i._notifDuedateChange.to) + '</span></div>';
    } else if (i._notifType !== 'assigned' && i._notifType !== 'mention' && changeDesc) {
      detailBadgesHtml += '<div style="display:inline-flex; align-items:center; font-size:11px; margin-top:6px; font-weight:600; background:var(--gray-50); border:1px solid var(--gray-100); padding:2px 6px; border-radius:4px; margin-right:6px; color:var(--gray-700);">' + escHtml(changeDesc) + '</div>';
    }

    const userObj = i._notifActor || (i._notifType === 'created' ? i.fields.assignee : i.fields.reporter);
    const userName = userObj ? userObj.displayName : 'Unknown User';

    return `<div class="notif-item${isUnread ? ' unread' : ''}" id="ni-${escHtml(i.key)}" style="border-bottom:1px solid var(--gray-100);"><div class="notif-item-body" onclick="markOneRead('${escHtml(i.key)}','${escHtml(i.fields && i.fields.updated ? i.fields.updated : '')}'); closeNotifPanel(); openDrawer('${escHtml(i.key)}')" style="padding:10px 14px;"><div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;"><span style="font-size:11px; font-weight:700; color:var(--blue); font-family:monospace;">${escHtml(i.key)}</span><span class="badge status-badge ${si.cls}" style="font-size:10px; padding:1px 5px;">${escHtml(si.label)}</span></div>${parentHtml}<div style="font-size:13px; font-weight:500; color:var(--gray-900); line-height:1.4; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escHtml(i.fields.summary)}">${escHtml(i.fields.summary)}</div>${detailBadgesHtml ? `<div style="display:flex; flex-wrap:wrap;">${detailBadgesHtml}</div>` : ''}<div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px; font-size:11px; color:var(--gray-400); gap:12px;"><span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1;">${escHtml(projName)} · ${relativeDate(i.fields.updated)}</span><div style="display:inline-flex; align-items:center; gap:6px; background:var(--gray-50); padding:2px 6px; border-radius:4px; border:1px solid var(--gray-100); flex-shrink:0;"><span style="font-size:11px; color:var(--gray-700); font-weight:600;">${escHtml(userName)}</span><div style="transform:scale(0.75); transform-origin:right center; margin-right:-4px; margin-left:-2px;">${avatarHtml(userObj)}</div></div></div></div>${isUnread ? `<button class="notif-dismiss" title="Mark as read" onclick="markOneRead('${escHtml(i.key)}','${escHtml(i.fields && i.fields.updated ? i.fields.updated : '')}',event)" style="border-left:1px solid var(--gray-100); color:var(--gray-300);">✓</button>` : ''}</div>`;
  };

  const sortedHtmlItems = sortedItems.length ? sortedItems.map(i => makeItem(i)).join('') : '<div style="padding:32px 24px; text-align:center; color:var(--gray-400); font-size:13px;">No activity in the last 30 days</div>';

  return '<div class="notif-panel-header" style="padding:12px 14px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between;"><span style="font-weight:700; font-size:14px; color:var(--gray-900);">Activity Stream</span><div style="display:flex; align-items:center; gap:12px;"><label class="toggle-wrap" title="Notification sound" style="cursor:pointer; font-size:12px; display:inline-flex; align-items:center; gap:4px; color:var(--gray-500); font-weight:500;"><span>🔔 Sound</span><label class="toggle-switch" style="margin:0;"><input type="checkbox" ' + (state.soundEnabled ? 'checked' : '') + ' onchange="toggleNotifSound(this.checked)"><span class="toggle-track"></span></label></label></label>' + (state.notifUnread > 0 ? '<button class="week-nav-today" onclick="markAllNotifsRead()" style="padding:3px 8px; font-size:11px; margin-left:4px;">Mark all read</button>' : '') + '</div></div><div class="notif-list" style="max-height:400px; overflow-y:auto; min-width:390px;">' + sortedHtmlItems + '</div>';
}

function markNotifsRead() { markAllNotifsRead(); }
