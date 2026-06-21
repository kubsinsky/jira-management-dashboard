const { execSync } = require('child_process');
const path = require('path');

module.exports = {
  appId: 'com.booksy.ops-dashboard',
  productName: 'Jira Management Dashboard',
  copyright: 'Jakub Rusecki',

  // Ad-hoc sign the .app after packing, before DMG creation.
  // This changes the macOS error from "damaged" (unbypassable) to
  // "unverified developer" (right-click → Open to bypass).
  afterPack: async (context) => {
    if (context.electronPlatformName !== 'darwin') return;
    const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    try {
      execSync(`codesign --deep --force --sign - "${appPath}"`, { stdio: 'inherit' });
      console.log('✅ Ad-hoc signed:', appPath);
    } catch (e) {
      console.warn('⚠️  Ad-hoc signing failed (non-fatal):', e.message);
    }
  },

  directories: {
    output: 'dist',
    buildResources: 'build',
  },

  asar: false,

  // All files packed inside the .app bundle
  files: [
    'main.js',
    'preload.js',
    'server.js',
    'index.html',
    'splash.html',
    'quick-note-win.html',
    'editor-engine.js',
    'notif.mp3',
    'package.json',
    'node_modules/**/*',
    '!node_modules/electron/**',
    '!node_modules/electron-builder/**',
    '!dist/**',
  ],

  // No extraResources — credentials live only in ~/Library/Application Support/…/config.json
  extraResources: [],

  mac: {
    category: 'public.app-category.productivity',
    icon: 'build/icon.icns',
    target: [{ target: 'dmg', arch: ['arm64'] }],
    // Required for the app to appear in macOS System Settings → Notifications
    extendInfo: {
      NSUserNotificationAlertStyle: 'alert',
      NSUserNotificationsUsageDescription: 'Jira Management Dashboard sends alerts when tickets are assigned to you or you are mentioned.',
    },
  },

  dmg: {
    title: 'Jira Management Dashboard',
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: 'link', path: '/Applications' },
    ],
  },

  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
  },
};
