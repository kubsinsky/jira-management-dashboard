// Only load .env in development (not when running as a packaged Electron app)
if (!process.env.USER_DATA_PATH) {
  require('dotenv').config();
}
const express = require('express');
const https   = require('https');
const path    = require('path');
const fs      = require('fs');
const fsPromises = fs.promises;

const app = express();

// ── Config loading ────────────────────────────────────────────────────────────
// In production: config.json in userData only (no .env fallback)
// In development: config.json > .env > defaults
let _cfg = {};

function configPath() {
  const base = process.env.USER_DATA_PATH || __dirname;
  return path.join(base, 'config.json');
}

function loadConfig() {
  try {
    const p = configPath();
    if (fs.existsSync(p)) {
      _cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
      return;
    }
  } catch {}
  _cfg = {};
}

const isDev = !process.env.USER_DATA_PATH;
function getEmail()  { return _cfg.email  || (isDev ? process.env.ATLASSIAN_EMAIL : '') || ''; }
function getToken()  { return _cfg.token  || (isDev ? process.env.ATLASSIAN_TOKEN : '') || ''; }
function getHost()   { return _cfg.host   || (isDev ? process.env.JIRA_HOST       : '') || ''; }
function getAuth()   {
  const t = getToken(), e = getEmail();
  return t ? 'Basic ' + Buffer.from(`${e}:${t}`).toString('base64') : '';
}
function isConfigured() { return !!(getToken() && getEmail() && getHost()); }

loadConfig(); // initial load

// ── Express setup ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Config endpoints (used by settings screen) ────────────────────────────────
app.get('/app-config', (req, res) => {
  res.json({
    configured:         isConfigured(),
    host:               getHost(),
    email:              getEmail(),
    boardId:            _cfg.boardId            || null,
    boardName:          _cfg.boardName          || null,
    quickNoteShortcut:  _cfg.quickNoteShortcut  || '',
    // never send token to frontend
  });
});

app.post('/app-config', async (req, res) => {
  const { host, email, token, boardId, boardName, quickNoteShortcut } = req.body || {};
  if (!host || !email) {
    return res.status(400).json({ error: 'host and email are required' });
  }
  // If no token provided, keep the existing one (allows updating board without re-entering token)
  const existingToken = getToken();
  const resolvedToken = (token && token.trim()) ? token.trim() : existingToken;
  if (!resolvedToken) {
    return res.status(400).json({ error: 'API token is required for first-time setup' });
  }
  const cfg = {
    host:      host.trim(),
    email:     email.trim(),
    token:     resolvedToken,
    ...(boardId            ? { boardId:   Number(boardId) }        : {}),
    ...(boardName          ? { boardName: boardName.trim() }        : {}),
    ...(quickNoteShortcut !== undefined ? { quickNoteShortcut: String(quickNoteShortcut || '').trim() } : {}),
  };
try {
    await fsPromises.writeFile(configPath(), JSON.stringify(cfg, null, 2));
    loadConfig();         // hot-reload
    invalidateTeamCache(); // force re-fetch on next /teams call
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Version info ─────────────────────────────────────────────────────────────
const BUILD_INFO = {
  version:   require('./package.json').version,
  buildDate: '2026-06-11', // update with each release
  author:    'Jakub Rusecki',
};
app.get('/version', (_req, res) => res.json(BUILD_INFO));

// Lightweight endpoint — update only boardId/boardName without re-entering credentials
app.post('/app-config/board', async (req, res) => {
  if (!isConfigured()) return res.status(401).json({ error: 'not_configured' });
  const { boardId, boardName } = req.body || {};
  loadConfig(); // make sure we have latest values
  if (boardId) {
    _cfg.boardId   = Number(boardId);
    _cfg.boardName = boardName ? String(boardName).trim() : (_cfg.boardName || '');
  } else {
    delete _cfg.boardId;
    delete _cfg.boardName;
  }
try {
    await fsPromises.writeFile(configPath(), JSON.stringify(_cfg, null, 2));
    loadConfig();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Jira proxy ────────────────────────────────────────────────────────────────
function makeProxy(basePath) {
  return (req, res) => {
    if (!isConfigured()) {
      return res.status(401).json({ error: 'not_configured' });
    }
    const apiPath = req.params[0];
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const targetPath = basePath + '/' + apiPath + qs;

    const options = {
      hostname: getHost(), port: 443,
      path: targetPath, method: req.method,
      headers: { Authorization: getAuth(), Accept: 'application/json', 'Content-Type': 'application/json' },
    };

    const proxyReq = https.request(options, (proxyRes) => {
      res.status(proxyRes.statusCode);
      res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/json');
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (err) => {
      console.error('[proxy error]', err.message);
      if (!res.headersSent) res.status(502).json({ error: err.message });
    });
    if (['POST','PUT','PATCH'].includes(req.method) && req.body && Object.keys(req.body).length) {
      const bodyStr = JSON.stringify(req.body);
      proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyStr));
      proxyReq.write(bodyStr);
    }
    proxyReq.end();
  };
}

// ── Attachment upload (multipart passthrough — must be before generic /api/* route) ──
app.post('/api/issue/:issueKey/attachments', (req, res) => {
  if (!isConfigured()) return res.status(401).json({ error: 'not_configured' });
  const targetPath = `/rest/api/3/issue/${req.params.issueKey}/attachments`;
  const options = {
    hostname: getHost(), port: 443,
    path: targetPath, method: 'POST',
    headers: {
      Authorization: getAuth(),
      'X-Atlassian-Token': 'no-check',
      'Content-Type':   req.headers['content-type'],
      'Content-Length': req.headers['content-length'],
    },
  };
  const proxyReq = https.request(options, (proxyRes) => {
    res.status(proxyRes.statusCode);
    res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/json');
    proxyRes.pipe(res);
  });
  proxyReq.on('error', err => res.status(502).json({ error: err.message }));
  req.pipe(proxyReq);
});

app.all('/api/*',     makeProxy('/rest/api/3'));
app.all('/agile/*',   makeProxy('/rest/agile/1.0'));
app.all('/gateway/*', makeProxy('/gateway'));

// ── Teams + Field config (cached) ─────────────────────────────────────────────
let _cachedTeams       = null;
let _cachedFieldConfig = null;

function httpsPost(hostname, path, auth, body) {
  const bodyStr = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    let data = '';
    const req = https.request(
      { hostname, port: 443, path, method: 'POST',
        headers: { Authorization: auth, Accept: 'application/json',
          'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } },
      res => { res.on('data', c => data += c); res.on('end', () => resolve(data)); }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// Invalidate caches when config changes (called in POST /app-config)
function invalidateTeamCache() { _cachedTeams = null; _cachedFieldConfig = null; }

app.get('/teams', async (req, res) => {
  if (!isConfigured()) return res.status(401).json({ error: 'not_configured' });
  // force=true bypasses cache (useful for debugging)
  if (req.query.force !== 'true' && _cachedTeams !== null) return res.json(_cachedTeams);
  try {
    // Atlassian Teams REST API not accessible externally — collect teams from issue field values instead.
    const cfg = _cachedFieldConfig;
    const teamFieldId   = cfg?.teamFieldId   || 'customfield_10001';
    // Team fields use "FieldName[FieldName]" JQL syntax, NOT cf[NNNNN]
    const teamFieldName = cfg?.teamFieldName  || 'Team';
    const teamFieldJql  = `"${teamFieldName}[${teamFieldName}]"`;

    console.log(`[teams] fetching — fieldId=${teamFieldId} jql=${teamFieldJql}`);

    // Always fetch both the detected field AND the canonical atlassian-team field
    // so we don't miss data if field detection picked the wrong one
    const fieldsToFetch = [...new Set([teamFieldId, 'customfield_10001'])];

    const raw = await httpsPost(getHost(), '/rest/api/3/search/jql', getAuth(), {
      jql: `${teamFieldJql} is not EMPTY ORDER BY updated DESC`,
      fields: fieldsToFetch,
      maxResults: 200,
    });
    const j = JSON.parse(raw);

    if (j.errorMessages || j.errors) {
      console.warn('[teams] JQL error:', JSON.stringify(j.errorMessages || j.errors));
      // If "Team[Team]" JQL fails, try alternative field names
      const altNames = ['Squad', 'Team Name', 'team'];
      for (const altName of altNames) {
        const altJql = `"${altName}[${altName}]"`;
        try {
          const altRaw = await httpsPost(getHost(), '/rest/api/3/search/jql', getAuth(), {
            jql: `${altJql} is not EMPTY ORDER BY updated DESC`,
            fields: fieldsToFetch,
            maxResults: 200,
          });
          const altJ = JSON.parse(altRaw);
          if (!altJ.errorMessages && !altJ.errors && altJ.issues?.length) {
            console.log(`[teams] found issues using alt JQL: ${altJql}`);
            j.issues = altJ.issues;
            break;
          }
        } catch {}
      }
    }

// Wczytujemy dotychczas zapamiętane zespoły z pliku konfiguracyjnego (żeby stare nie znikały)
    const teamsMap = _cfg.persistedTeams || {};

    for (const issue of (j.issues || [])) {
      // Sprawdzamy wykryte pole zespołu oraz domyślne pole Atlassiana
      const t = issue.fields?.[teamFieldId] || issue.fields?.['customfield_10001'];
      if (t && t.id && (t.name || t.title)) {
        teamsMap[t.id] = {
          id:        t.id,
          name:      t.name || t.title,
          avatarUrl: t.avatarUrl || t.smallAvatarImageUrl || '',
        };
      }
    }
    const teams = Object.values(teamsMap).sort((a, b) => a.name.localeCompare(b.name));
    console.log(`[teams] Łącznie w pamięci: ${teams.length} zespołów (zaktualizowano na bazie ${(j.issues||[]).length} najnowszych biletów)`);
    
// Zapisujemy rozszerzoną listę na stałe do pliku config.json
    _cfg.persistedTeams = teamsMap;
    try {
      await fsPromises.writeFile(configPath(), JSON.stringify(_cfg, null, 2));
    } catch (e) {
      console.error('[teams] Błąd zapisu bazy zespołów do pliku:', e.message);
    }

    _cachedTeams = teams;
    res.json(teams);
  } catch(e) {
    console.error('[teams]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Teams diagnostic endpoint ─────────────────────────────────────────────────
// GET /teams-debug  — returns raw field detection + sample issue data to help diagnose
app.get('/teams-debug', async (req, res) => {
  if (!isConfigured()) return res.status(401).json({ error: 'not_configured' });
  try {
    const auth = getAuth();
    const host = getHost();

    // 1. Get all fields
    let fieldsRaw = '';
    await new Promise((resolve, reject) => {
      let d = '';
      const r = https.request(
        { hostname: host, port: 443, path: '/rest/api/3/field', method: 'GET',
          headers: { Authorization: auth, Accept: 'application/json' } },
        res2 => { res2.on('data', c => d += c); res2.on('end', () => { fieldsRaw = d; resolve(); }); }
      );
      r.on('error', reject); r.end();
    });
    const fields = JSON.parse(fieldsRaw);
    const teamRelated = fields.filter(f =>
      f.name?.toLowerCase().includes('team') ||
      f.schema?.type === 'team' ||
      f.schema?.custom?.toLowerCase().includes('team')
    );

    // 2. Try a sample JQL search with team field
    const teamFieldName = _cachedFieldConfig?.teamFieldName || 'Team';
    const teamFieldId   = _cachedFieldConfig?.teamFieldId   || 'customfield_10001';
    const jql = `"${teamFieldName}[${teamFieldName}]" is not EMPTY ORDER BY updated DESC`;
    let jqlResult = null;
    try {
      const raw = await httpsPost(host, '/rest/api/3/search/jql', auth, {
        jql, fields: [teamFieldId], maxResults: 3,
      });
      const j = JSON.parse(raw);
      jqlResult = {
        total: j.total,
        errorMessages: j.errorMessages,
        errors: j.errors,
        sampleIssues: (j.issues || []).map(iss => ({
          key: iss.key,
          teamFieldValue: iss.fields?.[teamFieldId],
          allCustomFields: Object.entries(iss.fields || {})
            .filter(([k]) => k.startsWith('customfield_'))
            .filter(([,v]) => v !== null)
            .slice(0, 10)
            .reduce((o,[k,v]) => { o[k] = v; return o; }, {}),
        })),
      };
    } catch(e) { jqlResult = { error: e.message }; }

    res.json({
      cachedFieldConfig: _cachedFieldConfig,
      teamRelatedFields: teamRelated.map(f => ({ id: f.id, name: f.name, type: f.schema?.type, custom: f.schema?.custom })),
      jqlUsed: jql,
      jqlResult,
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Field config: auto-detect Sprint/Team field IDs + available statuses ───────
app.get('/field-config', async (req, res) => {
  if (!isConfigured()) return res.status(401).json({ error: 'not_configured' });
  if (_cachedFieldConfig) return res.json(_cachedFieldConfig);
  try {
    const auth = getAuth();
    const host = getHost();

    // Fetch all fields and all statuses in parallel
    const [fieldsRaw, statusesRaw] = await Promise.all([
      new Promise((resolve, reject) => {
        let d = '';
        const r = https.request(
          { hostname: host, port: 443, path: '/rest/api/3/field', method: 'GET',
            headers: { Authorization: auth, Accept: 'application/json' } },
          res => { res.on('data', c => d += c); res.on('end', () => resolve(d)); }
        );
        r.on('error', reject); r.end();
      }),
      new Promise((resolve, reject) => {
        let d = '';
        const r = https.request(
          { hostname: host, port: 443, path: '/rest/api/3/status', method: 'GET',
            headers: { Authorization: auth, Accept: 'application/json' } },
          res => { res.on('data', c => d += c); res.on('end', () => resolve(d)); }
        );
        r.on('error', reject); r.end();
      }),
    ]);

    const fields   = JSON.parse(fieldsRaw);
    const statuses = JSON.parse(statusesRaw);

    // ── Detect Sprint field ───────────────────────────────────────────────────
    const sprintField = fields.find(f =>
      f.schema?.custom?.toLowerCase().includes('sprint') ||
      f.name?.toLowerCase() === 'sprint'
    ) || { id: 'customfield_10020', name: 'Sprint' };

    // ── Detect Team field ─────────────────────────────────────────────────────
    // Priority order:
    //   1. schema.type === 'team'  (Atlassian Team field — customfield_10001 typically)
    //   2. schema.custom contains 'atlassian-team'
    //   3. name === 'team' (last resort — may pick wrong field if multiple exist)
    // NOTE: do NOT use schema.custom.includes('team') — it matches unrelated fields
    const teamField =
      fields.find(f => f.schema?.type === 'team') ||
      fields.find(f => f.schema?.custom?.includes('atlassian-team')) ||
      fields.find(f => f.name?.toLowerCase() === 'team' && f.schema?.type === 'option') ||
      { id: 'customfield_10001', name: 'Team' };

    console.log(`[field-config] sprint: ${sprintField.id} (${sprintField.name}), team: ${teamField.id} (${teamField.name})`);
    // Log all team-related custom fields for debugging
    const teamRelated = fields.filter(f => f.name?.toLowerCase().includes('team') || f.schema?.type === 'team');
    if (teamRelated.length) console.log('[field-config] team-related fields:', teamRelated.map(f => `${f.id}/${f.name}/${f.schema?.type}`).join(', '));

    // ── Build JQL fragment for team field ────────────────────────────────────
    // Team-type fields use "Name[Name]" syntax in JQL (e.g. "Team[Team]")
    // cf[NNNNN] does NOT work for team-type fields
    const teamJql = `"${teamField.name}[${teamField.name}]"`;

    // ── Build status list (non-done categories) ───────────────────────────────
    const statusList = Array.isArray(statuses)
      ? statuses
          .filter(s => s.statusCategory?.key !== 'done')
          .map(s => ({
            id:       s.id,
            name:     s.name,
            catKey:   s.statusCategory?.key   || 'new',
            catName:  s.statusCategory?.name  || 'To Do',
          }))
          .sort((a, b) => {
            const ord = { indeterminate: 0, new: 1 };
            const ao = ord[a.catKey] ?? 9, bo = ord[b.catKey] ?? 9;
            if (ao !== bo) return ao - bo;
            return a.name.localeCompare(b.name);
          })
      : [];

    _cachedFieldConfig = {
      sprintFieldId:   sprintField.id,
      sprintFieldName: sprintField.name,
      teamFieldId:     teamField.id,
      teamFieldName:   teamField.name,
      teamFieldJql:    teamJql,
      statuses:        statusList,
    };
    res.json(_cachedFieldConfig);
  } catch(e) {
    console.error('[field-config]', e.message);
    // Return sensible defaults so app still works
    res.json({
      sprintFieldId:   'customfield_10020',
      sprintFieldName: 'Sprint',
      teamFieldId:     'customfield_10001',
      teamFieldName:   'Team',
      teamFieldJql:    'cf[10001]',
      statuses:        [],
    });
  }
});

app.get('/site-info', (req, res) => {
  if (!isConfigured()) return res.status(401).json({ error: 'not_configured' });
  const options = {
    hostname: getHost(), port: 443,
    path: '/_edge/tenant_info', method: 'GET',
    headers: { Authorization: getAuth(), Accept: 'application/json' },
  };
  const proxyReq = https.request(options, (proxyRes) => {
    res.status(proxyRes.statusCode);
    res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/json');
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (err) => res.status(502).json({ error: err.message }));
  proxyReq.end();
});

// ── Start ─────────────────────────────────────────────────────────────────────
function start(port) {
  port = port || process.env.PORT || 3000;
  return new Promise((resolve, reject) => {
    // Podpięcie hosta 127.0.0.1 gwarantuje izolację sieciową serwera
    app.listen(port, '127.0.0.1', () => {
      console.log(`\n✅  Jira Dashboard (Secure Mode) →  http://127.0.0.1:${port}`);
      if (isConfigured()) console.log(`   Proxying Jira safely as: ${getEmail()} @ ${getHost()}\n`);
      else console.log('   ⚠️  Dashboard credentials setup required.\n');
      resolve();
    }).on('error', reject);
  });
}

module.exports = { start };

if (require.main === module) {
  start().catch(err => { console.error(err); process.exit(1); });
}
