import os

path = 'src/jiraNotifications.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Fix JQL
content = content.replace(
    '`assignee = currentUser() AND (updated >= -30d OR created >= -30d) ORDER BY updated DESC`',
    '`assignee = "${CFG.me}" AND (updated >= -30d OR created >= -30d) ORDER BY updated DESC`'
)
content = content.replace(
    '`reporter = currentUser() AND assignee != currentUser() AND updated >= -30d ORDER BY updated DESC`',
    '`reporter = "${CFG.me}" AND assignee != "${CFG.me}" AND updated >= -30d ORDER BY updated DESC`'
)
content = content.replace(
    '`comment ~ "${CFG.me}" AND updated >= -30d ORDER BY updated DESC`',
    '`text ~ "${CFG.me}" AND updated >= -30d ORDER BY updated DESC`'
)

# 2. Fix notifications
old_notif_func = '''function _checkForNewNotifications(issues) {
  if (!window.electronAPI) return;

  if (_knownNotifKeys === null) {
    _knownNotifKeys = new Set(issues.map(i => i.key + '_' + (i.fields?.updated || '')));
    return;
  }

  let sent = 0;
  for (const issue of issues) {
    if (sent >= 3) break;
    const compositeKey = issue.key + '_' + (issue.fields?.updated || '');
    
    if (_knownNotifKeys.has(compositeKey)) continue;
    _knownNotifKeys.add(compositeKey);

    // Nie wysyłaj powiadomienia systemowego, jeśli to ja przed chwilą zamknąłem bilet
    if (issue.fields?.updatedBy?.accountId === CFG.me) continue;

    let prefix = '🎯 Assigned';
    if (issue._notifType === 'mention') prefix = '💬 Mentioned';
    if (issue._notifType === 'created') prefix = '💼 Team Update';
    
    const statusName = (issue.fields?.status?.name || '').toLowerCase();
    const isBlockerStatus = statusName.includes('block') || statusName.includes('hold');
    if (isBlockerStatus) {
      prefix = '🔥 BLOCKER / HOLD';
    }

    // SPRAWDZAMY FILTR WAŻNOŚCI: Jeśli włączono "Critical Only", pomijamy wyskakujące banery dla zwykłych zmian
    const isCriticalAlert = isBlockerStatus || issue._notifType === 'mention';
    if (state.criticalNotifsOnly && !isCriticalAlert) {
      continue; 
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
}'''

new_notif_func = '''function _checkForNewNotifications(issues) {
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
}'''

content = content.replace(old_notif_func, new_notif_func)

# 3. Remove Critical Only Toggle
# We will use regex or simple string replacement since it's a huge line
import re

# Match the <label ...><span>🔥 Desktop alerts: Critical only</span>... </label>
pattern = r'<label class="toggle-wrap" title="Filter system push notifications[^>]+>.*?<span>🔥 Desktop alerts: Critical only</span>.*?</label>'
content = re.sub(pattern, '', content)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Patch 2 applied successfully')
