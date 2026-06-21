const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  showNotification:      (payload)     => ipcRenderer.send('show-notification', payload),
  onNotifActionRead:     (cb)          => ipcRenderer.on('notif-action-read', (_e, data) => cb(data)),
  onNotifClicked:        (cb)          => ipcRenderer.on('notif-clicked', (_e, data) => cb(data)),
  registerNotifications: ()            => ipcRenderer.send('register-notifications'),
  setShortcut:           (sc)          => ipcRenderer.send('set-shortcut', sc),
  onShowQuickNote:       (cb)          => ipcRenderer.on('show-quick-note', (_e, key) => cb(key)),
  closeWindow:           ()            => ipcRenderer.send('close-quick-note-window'),
  onReloadQuickNote:     (cb)          => ipcRenderer.on('reload-quick-note', cb),
  onSaveAndHide:         (cb)          => ipcRenderer.on('save-and-hide', cb),
  openExternal:          (url)         => ipcRenderer.send('open-external-link', url),
  openQuickNoteWithKey:  (key, summary) => ipcRenderer.send('open-quick-note-key', { key, summary: summary || '' }),
  setBadgeCount:         (n)           => ipcRenderer.send('set-badge-count', n),
});
