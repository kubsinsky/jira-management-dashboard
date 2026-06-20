import os

path = 'src/jiraNotifications.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace JQL
old_assigned = 'assignee = "${CFG.me}" AND (updated >= -30d OR created >= -30d)'
new_assigned = 'assignee = currentUser() AND (updated >= -30d OR created >= -30d)'
content = content.replace(old_assigned, new_assigned)

old_created = 'reporter = "${CFG.me}" AND assignee != "${CFG.me}" AND updated >= -30d'
new_created = 'reporter = currentUser() AND assignee != currentUser() AND updated >= -30d'
content = content.replace(old_created, new_created)

# 2. Changelog Replace
old_chg_start = '// Audyt ostatniej mutacji w historii zgłoszenia'
old_chg_end = 'i._notifChangeDesc = changeDescription;'

before_chg = content.split(old_chg_start)[0]
after_chg = content.split(old_chg_end)[1]

new_chg = '''// Audyt ostatniej mutacji w historii zgloszenia (Smart Enterprise Core)
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
          if (Array.isArray(latest.items) && latest.items.length > 0) {
            latest.items.forEach(item => {
              const fLower = (item.field || '').toLowerCase();
              const fromStr = item.fromString ? item.fromString.trim() : '';
              const toStr = item.toString ? item.toString.trim() : '';
              if (fLower === 'status' && fromStr !== toStr) statusChange = { from: fromStr, to: toStr };
              if (fLower === 'duedate' && fromStr !== toStr) duedateChange = { from: fromStr || 'None', to: toStr || 'None' };
            });

            changeDescription = latest.items.map(item => {
              const fName = item.field ? item.field.charAt(0).toUpperCase() + item.field.slice(1) : 'Field';
              const fromStr = item.fromString ? item.fromString.trim() : '';
              const toStr = item.toString ? item.toString.trim() : '';
              if (fromStr && toStr && fromStr !== toStr) return fName + ': ' + fromStr + ' -> ' + toStr;
              elif (toStr) return fName + ': ' + toStr;
              else return 'Updated ' + fName;
            }).join(' | ');
          }
        }
      }
      
      if (!changeDescription) {
        if (i._notifType === 'mention') changeDescription = 'Added a comment';
        elif (i._notifType === 'created') changeDescription = 'Created / assigned this issue';
        else changeDescription = 'Modified ticket details';
      }
      
      i._notifActor = actor;
      i._notifChangeDesc = changeDescription;
      i._notifStatusChange = statusChange;
      i._notifDuedateChange = duedateChange;'''

new_chg = new_chg.replace('elif', 'else if')

content = before_chg + new_chg + after_chg

# 3. Render Replace
old_render_start = 'function renderNotifContent() {'
before_render = content.split('function renderNotifContent() {')[0]
after_render = 'function markNotifsRead() {' + content.split('function markNotifsRead() {')[1]

new_render = '''function renderNotifContent() {
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
    const si = statusInfo(i.fields.status);
    const projName = i.fields.project && i.fields.project.name ? i.fields.project.name : '';
    
    let typeBadge = '<span style="background:var(--blue-light); color:var(--blue); font-size:10px; font-weight:700; padding:1px 5px; border-radius:4px;">🎯 Assigned</span>';
    if (i._notifType === 'mention') typeBadge = '<span style="background:var(--purple-light); color:var(--purple); font-size:10px; font-weight:700; padding:1px 5px; border-radius:4px;">💬 Mentioned</span>';
    if (i._notifType === 'created') typeBadge = '<span style="background:var(--green-light); color:#166534; font-size:10px; font-weight:700; padding:1px 5px; border-radius:4px;">💼 Updated</span>';

    const statusName = (i.fields && i.fields.status && i.fields.status.name ? i.fields.status.name : '').toLowerCase();
    if (statusName.includes('block') || statusName.includes('hold')) {
      typeBadge = '<span style="background:var(--red-light); color:var(--red); font-size:10px; font-weight:700; padding:1px 5px; border-radius:4px;">🔥 Blocker</span>';
    }

    const userObj = i._notifActor || (i._notifType === 'created' ? i.fields.assignee : i.fields.reporter);
    const userName = userObj ? userObj.displayName : 'Unknown User';
    const changeDesc = i._notifChangeDesc || 'Updated issue details';

    let detailBadgesHtml = '';
    if (i._notifStatusChange) {
       const fromC = getJiraColor(i._notifStatusChange.from);
       const toC = getJiraColor(i._notifStatusChange.to);
       detailBadgesHtml += '<div style="display:inline-flex; align-items:center; gap:4px; font-size:11px; margin-top:6px; font-weight:600; background:var(--gray-50); border:1px solid var(--gray-100); padding:2px 6px; border-radius:4px; margin-right:6px;"><span style="color:var(--gray-500);">Status:</span><span style="background:' + fromC.bg + '; color:' + fromC.text + '; padding:1px 4px; border-radius:3px; font-size:10px;">' + escHtml(i._notifStatusChange.from) + '</span><span style="color:var(--gray-400);">→</span><span style="background:' + toC.bg + '; color:' + toC.text + '; padding:1px 4px; border-radius:3px; font-size:10px;">' + escHtml(i._notifStatusChange.to) + '</span></div>';
    }
    if (i._notifDuedateChange) {
       detailBadgesHtml += '<div style="display:inline-flex; align-items:center; gap:4px; font-size:11px; margin-top:6px; font-weight:600; background:var(--gray-50); border:1px solid var(--gray-100); padding:2px 6px; border-radius:4px;"><span style="color:var(--gray-500);">📅 Due:</span><span style="color:var(--gray-700);">' + escHtml(i._notifDuedateChange.from) + '</span><span style="color:var(--gray-400);">→</span><span style="color:var(--gray-700);">' + escHtml(i._notifDuedateChange.to) + '</span></div>';
    }

    return '<div class="notif-item' + (isUnread ? ' unread' : '') + '" id="ni-' + escHtml(i.key) + '" style="border-bottom:1px solid var(--gray-100);"><div class="notif-item-body" onclick="markOneRead(\\'' + escHtml(i.key) + '\\',\\'' + (i.fields && i.fields.updated ? escHtml(i.fields.updated) : '') + '\\'); closeNotifPanel(); openDrawer(\\'' + escHtml(i.key) + '\\')" style="padding:10px 14px;"><div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">' + typeBadge + '<span style="font-size:11px; font-weight:700; color:var(--blue); font-family:monospace;">' + escHtml(i.key) + '</span><span class="badge status-badge ' + si.cls + '" style="font-size:10px; padding:1px 5px;">' + escHtml(si.label) + '</span></div><div style="font-size:13px; font-weight:500; color:var(--gray-900); line-height:1.4; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="' + escHtml(i.fields.summary) + '">' + escHtml(i.fields.summary) + '</div>' + (detailBadgesHtml ? '<div style="display:flex; flex-wrap:wrap;">' + detailBadgesHtml + '</div>' : '') + 
    (() => {
          if (i._notifType === 'mention' && i.fields && i.fields.comment && i.fields.comment.comments) {
            const myName = CFG.meUser && CFG.meUser.displayName ? CFG.meUser.displayName : '';
            const matchingCmt = [...i.fields.comment.comments].reverse().find(c => {
              const text = adfToText(c.body).toLowerCase();
              return text.includes(CFG.me.toLowerCase()) || (myName && text.includes(myName.toLowerCase()));
            });
            if (matchingCmt) {
              _renderingIssueKey = i.key;
              const renderedHtml = renderADF(matchingCmt.body);
              _renderingIssueKey = null;
              return '<blockquote style="margin:6px 0 2px 0; padding:4px 10px; border-radius:0 6px 6px 0; border-left:3.5px solid var(--purple); background:var(--purple-light); font-size:12px; color:var(--gray-700); max-height:60px; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; line-height:1.4;">' + renderedHtml + '</blockquote>';
            }
          }
          return '';
        })() + 
    '<div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px; font-size:11px; color:var(--gray-400); gap:12px;"><span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1;">' + escHtml(projName) + ' · ' + relativeDate(i.fields.updated) + ' · <span style="color:var(--gray-700); font-weight:600; background:var(--gray-100); border:1px solid var(--border); padding:2px 6px; border-radius:5px; font-size:10.5px;">' + escHtml(changeDesc) + '</span></span><div style="display:inline-flex; align-items:center; gap:6px; background:var(--gray-50); padding:2px 6px; border-radius:4px; border:1px solid var(--gray-100); flex-shrink:0;"><span style="font-size:11px; color:var(--gray-700); font-weight:600;">' + escHtml(userName) + '</span><div style="transform:scale(0.75); transform-origin:right center; margin-right:-4px; margin-left:-2px;">' + avatarHtml(userObj) + '</div></div></div></div>' + (isUnread ? '<button class="notif-dismiss" title="Mark as read" onclick="markOneRead(\\'' + escHtml(i.key) + '\\',\\'' + (i.fields && i.fields.updated ? escHtml(i.fields.updated) : '') + '\\',event)" style="border-left:1px solid var(--gray-100); color:var(--gray-300);">✓</button>' : '') + '</div>';
  };

  const sortedHtmlItems = sortedItems.length ? sortedItems.map(i => makeItem(i)).join('') : '<div style="padding:32px 24px; text-align:center; color:var(--gray-400); font-size:13px;">No activity in the last 30 days</div>';

  return '<div class="notif-panel-header" style="padding:12px 14px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between;"><span style="font-weight:700; font-size:14px; color:var(--gray-900);">Activity Stream</span><div style="display:flex; align-items:center; gap:12px;"><label class="toggle-wrap" title="Notification sound" style="cursor:pointer; font-size:12px; display:inline-flex; align-items:center; gap:4px; color:var(--gray-500); font-weight:500;"><span>🔔 Sound</span><label class="toggle-switch" style="margin:0;"><input type="checkbox" ' + (state.soundEnabled ? 'checked' : '') + ' onchange="toggleNotifSound(this.checked)"><span class="toggle-track"></span></label></label><label class="toggle-wrap" title="Filter system push notifications. When enabled, desktop pop-up banners will only show for Blockers and Mentions." style="cursor:pointer; font-size:12px; display:inline-flex; align-items:center; gap:4px; color:var(--gray-500); font-weight:500; margin-left:2px;"><span>🔥 Desktop alerts: Critical only</span><label class="toggle-switch" style="margin:0;"><input type="checkbox" ' + (state.criticalNotifsOnly ? 'checked' : '') + ' onchange="state.criticalNotifsOnly=this.checked; persistState();"><span class="toggle-track"></span></label></label>' + (state.notifUnread > 0 ? '<button class="week-nav-today" onclick="markAllNotifsRead()" style="padding:3px 8px; font-size:11px; margin-left:4px;">Mark all read</button>' : '') + '</div></div><div class="notif-list" style="max-height:400px; overflow-y:auto; min-width:390px;">' + sortedHtmlItems + '</div>';
}
'''

content = before_render + new_render + '\n' + after_render

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Patch applied successfully')
