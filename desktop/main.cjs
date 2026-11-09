/**
 * MachSim desktop shell (Electron main process).
 *
 * Serves the built renderer (desktop/app, copied from ../dist by scripts/sync-app.cjs) through a
 * privileged custom scheme `app://machsim/` so module workers and fetch behave like a normal origin.
 * Exposes a small, explicit file API to the renderer through preload.cjs (no Node in the renderer).
 * Native dialog texts come from src/i18n/desktop-strings.json (copied to app/i18n-desktop.json by
 * scripts/sync-app.cjs) in the language the renderer reports through `setLanguage`.
 *
 * Dev mode: `npm run dev -- --dev` with MACHSIM_DEV_URL=http://localhost:5173 loads the Vite dev server.
 */
'use strict';

const { app, BrowserWindow, protocol, ipcMain, dialog, Menu, shell, net, clipboard, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const APP_DIR = path.join(__dirname, 'app');
const SCHEME = 'app';
const HOST = 'machsim';
const DEV_URL = process.env.MACHSIM_DEV_URL || (process.argv.includes('--dev') ? 'http://localhost:5173' : '');
/** --smoke: hidden window, print rendered text and console errors, exit (used by automated checks). */
const SMOKE = process.argv.includes('--smoke');
const smokeErrors = [];

/**
 * Command-line batch mode (MachSim.exe --batch file.msim --analysis tran --out results.csv,
 * MachSim.exe --script file.js, or --help): no visible window; the renderer (index.html?batch) parses the arguments
 * (src/desktop/cli.ts), simulates and reports back through the machsim:batch-* IPC below. It may
 * only read / write the paths named on the command line, plus SPICE include files next to the input.
 */
const USER_ARGS = process.argv.slice(process.defaultApp ? 2 : 1);
// --script file.js (src/script/cli.ts) runs a user's JavaScript in a sandbox through the same hidden batch window; it may only
// open / save the files named on the command line, like --batch
const BATCH = USER_ARGS.some((a) => a === '--batch' || a.startsWith('--batch=') || a === '--script' || a.startsWith('--script=') || a === '--help' || a === '-h' || a === '/?');
const BATCH_CWD = process.cwd();
/** Absolute paths named on the command line (option values and bare arguments). */
const batchPaths = new Set(
  USER_ARGS.map((a) => (a.startsWith('--') ? (a.includes('=') ? a.slice(a.indexOf('=') + 1) : '') : a))
    .filter((a) => a && !a.startsWith('-') && a !== '/?')
    .map((a) => path.resolve(BATCH_CWD, a)),
);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.msim': 'application/json; charset=utf-8',
  '.msimproj': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

// ---------------------------------------------------------------- texts of the native dialogs
function loadStrings() {
  for (const p of [path.join(APP_DIR, 'i18n-desktop.json'), path.join(__dirname, '..', 'src', 'i18n', 'desktop-strings.json')]) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      /* try the next location */
    }
  }
  return {};
}
const STRINGS = loadStrings();
let lang = 'vi';
/** Text of a native-dialog string in the current UI language ({name} placeholders filled from vars). */
function s(key, vars) {
  const table = STRINGS[lang] || STRINGS.vi || {};
  const text = table[key] ?? (STRINGS.vi || {})[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
}

// ---------------------------------------------------------------- settings (window state, recent files)
const settingsFile = () => path.join(app.getPath('userData'), 'machsim-settings.json');
function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}
function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.error('settings write failed', err);
  }
  return next;
}
function addRecent(filePath) {
  const recent = (readSettings().recent || []).filter((p) => p !== filePath);
  recent.unshift(filePath);
  writeSettings({ recent: recent.slice(0, 12) });
}
function addRecentProject(filePath) {
  const recent = (readSettings().recentProjects || []).filter((p) => p !== filePath);
  recent.unshift(filePath);
  writeSettings({ recentProjects: recent.slice(0, 8) });
}

// Paths the renderer may write to: only ones the user picked in a dialog or opened this session.
const writablePaths = new Set();
// Project files (.msimproj) opened or created through a dialog this session: their folders may be
// read / written by relative path (no '..', no absolute paths).
const projectFiles = new Set();

/** Absolute path of `rel` inside the folder of project `projectPath`, or null when not allowed. */
function projectFilePath(projectPath, rel) {
  if (typeof projectPath !== 'string' || typeof rel !== 'string' || !projectFiles.has(projectPath)) return null;
  const clean = rel.replace(/\\/g, '/');
  if (!clean || clean.startsWith('/') || /^[A-Za-z]:/.test(clean) || clean.split('/').some((p) => p === '..' || p === '')) return null;
  const dir = path.dirname(projectPath);
  const abs = path.normalize(path.join(dir, clean));
  return abs.startsWith(dir + path.sep) ? abs : null;
}

function readProjectFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  projectFiles.add(filePath);
  writablePaths.add(filePath);
  addRecentProject(filePath);
  writeSettings({ lastDir: path.dirname(filePath) });
  return { path: filePath, name: path.basename(filePath), content };
}

const projectFilters = () => [{ name: s('filterProject'), extensions: ['msimproj'] }, { name: s('filterAll'), extensions: ['*'] }];

/** Open/save filters (names in the current language). */
const designFilters = () => [
  { name: s('filterDesign'), extensions: ['msim'] },
  { name: s('filterSpice'), extensions: ['cir', 'sp', 'spi', 'net', 'ckt', 'lib', 'mod', 'txt'] },
  { name: s('filterAll'), extensions: ['*'] },
];

/** Exchange formats File > Open also reads (renderer: src/ui/files/openAny.ts). */
const EXCHANGE_EXT = ['xml', 'kicad_sch', 'edf', 'edif', 'edn', 'edo'];
/** Closed formats of other programs: opened only to explain how to export them. */
const OTHER_EXT = ['dsn', 'ms14', 'ms13', 'ms12', 'ms11', 'ms10', 'ms9', 'ms8', 'ms7', 'msm', 'utsch', 'msmx', 'mp14', 'mpzip', 'prz', 'mst14', 'mst13'];
/** Files read as bytes (base64) instead of UTF-8 text. */
const BINARY_FILE = new RegExp(`\\.(png|${OTHER_EXT.join('|')})$`, 'i');
/** File > Open filters: every format first, then each kind. */
const openFilters = () => [
  { name: s('filterOpenable'), extensions: ['msim', 'msimtpl', 'cir', 'sp', 'spi', 'net', 'ckt', ...EXCHANGE_EXT, 'png', 'bak', ...OTHER_EXT] },
  { name: s('filterDesign'), extensions: ['msim', 'msimtpl'] },
  { name: s('filterExchange'), extensions: EXCHANGE_EXT },
  { name: s('filterSpice'), extensions: ['cir', 'sp', 'spi', 'net', 'ckt', 'lib', 'mod', 'txt'] },
  { name: s('filterSnippet'), extensions: ['png'] },
  { name: s('filterBackup'), extensions: ['bak'] },
  { name: s('filterOther'), extensions: OTHER_EXT },
  { name: s('filterAll'), extensions: ['*'] },
];

let mainWindow = null;
let dirty = false;
/** names of the documents with unsaved changes (document tabs), for the quit question */
let dirtyDocuments = [];
/** the renderer runs its own Close all question and answers with machsim:confirm-quit */
let rendererHandlesClose = false;
/** the window may close now (the renderer asked, or nothing is unsaved) */
let forceClose = false;
let pendingOpen = null; // file passed on the command line before the window was ready

function fileFromArgv(argv) {
  const candidate = argv.slice(1).find((a) => /\.(msim|cir|sp|spi|net|ckt|xml|kicad_sch|edf|edif)$/i.test(a) && fs.existsSync(a));
  return candidate ? path.resolve(candidate) : null;
}

function readDesignFile(filePath) {
  writablePaths.add(filePath);
  if (BINARY_FILE.test(filePath)) {
    if (fs.statSync(filePath).size > 64 * 1024 * 1024) throw new Error(s('badArguments'));
    return { path: filePath, name: path.basename(filePath), content: '', base64: fs.readFileSync(filePath).toString('base64') };
  }
  const content = fs.readFileSync(filePath, 'utf8');
  addRecent(filePath);
  return { path: filePath, name: path.basename(filePath), content };
}

/**
 * Keep `count` older versions of a file before it is overwritten: name.bak (newest), name.bak2 ...
 * Best effort: a failing backup never blocks the save itself.
 */
function rotateBackups(filePath, count) {
  const n = Math.min(9, Math.max(0, Math.floor(Number(count) || 0)));
  if (!n || !fs.existsSync(filePath)) return;
  const bak = (k) => `${filePath}.bak${k === 1 ? '' : k}`;
  try {
    if (fs.existsSync(bak(n))) fs.rmSync(bak(n), { force: true });
    for (let k = n - 1; k >= 1; k--) if (fs.existsSync(bak(k))) fs.renameSync(bak(k), bak(k + 1));
    fs.copyFileSync(filePath, bak(1));
  } catch (err) {
    console.error('backup failed', err);
  }
}

// ---------------------------------------------------------------- crash recovery
const recoveryDir = () => path.join(app.getPath('userData'), 'recovery');
const sessionFile = () => path.join(recoveryDir(), 'session.json');
const recoveryFile = () => path.join(recoveryDir(), 'autosave.json');
/** The previous run did not quit normally (read once at start-up), or the renderer crashed. */
let previousUnclean = false;
let rendererCrashed = false;

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

/** Start-up: remember whether the last run ended normally, then mark this run as running. */
function beginSession() {
  try {
    const prev = JSON.parse(fs.readFileSync(sessionFile(), 'utf8'));
    previousUnclean = !!prev && prev.running === true;
  } catch {
    previousUnclean = false;
  }
  try {
    writeAtomic(sessionFile(), JSON.stringify({ running: true, pid: process.pid, started: new Date().toISOString() }));
  } catch (err) {
    console.error('session marker failed', err);
  }
}

/** A normal quit: the next start offers no recovery. */
function endSession() {
  try {
    writeAtomic(sessionFile(), JSON.stringify({ running: false, ended: new Date().toISOString() }));
  } catch {
    /* best effort */
  }
}

function sendOpenFile(filePath) {
  if (!mainWindow) {
    pendingOpen = filePath;
    return;
  }
  try {
    mainWindow.webContents.send('machsim:open-file', readDesignFile(filePath));
  } catch (err) {
    dialog.showErrorBox('MachSim', s('openFailed', { path: filePath, message: err.message }));
  }
}

// ---------------------------------------------------------------- renderer file server
function registerAppProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== HOST) return new Response(s('notFound'), { status: 404 });
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const filePath = path.normalize(path.join(APP_DIR, rel));
    if (!filePath.startsWith(APP_DIR + path.sep)) return new Response(s('forbidden'), { status: 403 });
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return new Response(s('notFound'), { status: 404 });
    }
    const res = await net.fetch(pathToFileURL(filePath).toString());
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    return new Response(res.body, { status: 200, headers: { 'content-type': type } });
  });
}

// ---------------------------------------------------------------- IPC
function registerIpc() {
  ipcMain.handle('machsim:open-dialog', async (_e, opts = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: opts.title || s('openTitle'),
      properties: ['openFile'],
      filters: opts.spice ? [designFilters()[1], designFilters()[2]] : openFilters(),
      defaultPath: readSettings().lastDir,
    });
    if (result.canceled || !result.filePaths[0]) return null;
    writeSettings({ lastDir: path.dirname(result.filePaths[0]) });
    return readDesignFile(result.filePaths[0]);
  });

  ipcMain.handle('machsim:save-dialog', async (_e, opts = {}) => {
    const ext = opts.extension || 'msim';
    const result = await dialog.showSaveDialog(mainWindow, {
      title: opts.title || s('saveTitle'),
      defaultPath: path.join(readSettings().lastDir || app.getPath('documents'), opts.suggestedName || `untitled.${ext}`),
      filters: [{ name: opts.filterName || s('filterDesign'), extensions: [ext] }, designFilters()[2]],
    });
    if (result.canceled || !result.filePath) return null;
    if (typeof opts.content !== 'string') return null;
    fs.writeFileSync(result.filePath, opts.content, 'utf8');
    writablePaths.add(result.filePath);
    if (ext === 'msim') addRecent(result.filePath);
    writeSettings({ lastDir: path.dirname(result.filePath) });
    return { path: result.filePath, name: path.basename(result.filePath) };
  });

  ipcMain.handle('machsim:write-file', async (_e, filePath, content, opts = {}) => {
    if (typeof filePath !== 'string' || typeof content !== 'string') throw new Error(s('badArguments'));
    if (!writablePaths.has(filePath)) throw new Error(s('pathNotAllowed'));
    if (opts && opts.backups) rotateBackups(filePath, opts.backups);
    fs.writeFileSync(filePath, content, 'utf8');
    return { path: filePath, name: path.basename(filePath) };
  });

  ipcMain.handle('machsim:file-stat', async (_e, filePath) => {
    if (typeof filePath !== 'string' || !writablePaths.has(filePath)) throw new Error(s('pathNotAllowed'));
    if (!fs.existsSync(filePath)) return null;
    const st = fs.statSync(filePath);
    return { size: st.size, created: (st.birthtime.getTime() > 0 ? st.birthtime : st.ctime).toISOString(), modified: st.mtime.toISOString() };
  });

  ipcMain.handle('machsim:recovery-read', async () => (fs.existsSync(recoveryFile()) ? fs.readFileSync(recoveryFile(), 'utf8') || null : null));

  ipcMain.handle('machsim:recovery-write', async (_e, text) => {
    if (text === null) {
      fs.rmSync(recoveryFile(), { force: true });
      return;
    }
    if (typeof text !== 'string' || text.length > 64 * 1024 * 1024) throw new Error(s('badArguments'));
    writeAtomic(recoveryFile(), text);
  });

  ipcMain.handle('machsim:session-info', async () => {
    const info = { uncleanExit: previousUnclean || rendererCrashed };
    // reported once: after a crash the renderer offers the recovery, a reload must not ask again
    rendererCrashed = false;
    previousUnclean = false;
    return info;
  });

  ipcMain.handle('machsim:open-recent', async (_e, filePath) => {
    const recent = readSettings().recent || [];
    if (!recent.includes(filePath)) throw new Error(s('notRecent'));
    return readDesignFile(filePath);
  });

  ipcMain.handle('machsim:recent', () => (readSettings().recent || []).filter((p) => fs.existsSync(p)));

  ipcMain.handle('machsim:save-binary', async (_e, opts = {}) => {
    // PNG/SVG/CSV exports: data is a base64 string or text
    const result = await dialog.showSaveDialog(mainWindow, {
      title: opts.title || s('exportTitle'),
      defaultPath: path.join(readSettings().lastDir || app.getPath('documents'), opts.suggestedName || 'export'),
      filters: opts.filters || [designFilters()[2]],
    });
    if (result.canceled || !result.filePath) return null;
    if (opts.base64) fs.writeFileSync(result.filePath, Buffer.from(opts.base64, 'base64'));
    else fs.writeFileSync(result.filePath, String(opts.text ?? ''), 'utf8');
    return { path: result.filePath, name: path.basename(result.filePath) };
  });

  // ---- projects -------------------------------------------------------------------------------
  ipcMain.handle('machsim:open-project', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: s('openProjectTitle'), properties: ['openFile'], filters: projectFilters(), defaultPath: readSettings().lastDir });
    if (result.canceled || !result.filePaths[0]) return null;
    return readProjectFile(result.filePaths[0]);
  });

  ipcMain.handle('machsim:save-project-as', async (_e, content, suggestedName) => {
    if (typeof content !== 'string') throw new Error(s('badArguments'));
    const result = await dialog.showSaveDialog(mainWindow, {
      title: s('saveProjectTitle'),
      defaultPath: path.join(readSettings().lastDir || app.getPath('documents'), typeof suggestedName === 'string' && suggestedName ? suggestedName : 'project.msimproj'),
      filters: projectFilters(),
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, content, 'utf8');
    projectFiles.add(result.filePath);
    writablePaths.add(result.filePath);
    addRecentProject(result.filePath);
    writeSettings({ lastDir: path.dirname(result.filePath) });
    return { path: result.filePath, name: path.basename(result.filePath) };
  });

  ipcMain.handle('machsim:project-read', async (_e, projectPath, rel) => {
    const abs = projectFilePath(projectPath, rel);
    if (!abs) throw new Error(s('pathNotAllowed'));
    const data = fs.readFileSync(abs);
    writablePaths.add(abs);
    return { path: abs, name: path.basename(abs), base64: data.toString('base64') };
  });

  ipcMain.handle('machsim:project-write', async (_e, projectPath, rel, base64) => {
    const abs = projectFilePath(projectPath, rel);
    if (!abs || typeof base64 !== 'string') throw new Error(s('pathNotAllowed'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from(base64, 'base64'));
    writablePaths.add(abs);
    return { path: abs, name: path.basename(abs) };
  });

  ipcMain.handle('machsim:project-exists', async (_e, projectPath, rel) => {
    const abs = projectFilePath(projectPath, rel);
    return !!abs && fs.existsSync(abs);
  });

  ipcMain.handle('machsim:project-add-file', async (_e, projectPath) => {
    if (!projectFiles.has(projectPath)) throw new Error(s('pathNotAllowed'));
    const dir = path.dirname(projectPath);
    const result = await dialog.showOpenDialog(mainWindow, { title: s('addFileTitle'), properties: ['openFile'], defaultPath: dir, filters: [{ name: s('filterAll'), extensions: ['*'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const src = result.filePaths[0];
    if (src.startsWith(dir + path.sep)) return { rel: path.relative(dir, src).split(path.sep).join('/'), copied: false };
    // files outside the project folder are copied into it (a free name is chosen)
    const ext = path.extname(src);
    const stem = path.basename(src, ext);
    let name = path.basename(src);
    for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${stem}_${n}${ext}`;
    fs.copyFileSync(src, path.join(dir, name));
    return { rel: name, copied: true };
  });

  ipcMain.handle('machsim:open-binary', async (_e, opts = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: opts.title || s('openTitle'),
      properties: ['openFile'],
      filters: Array.isArray(opts.filters) ? opts.filters : [{ name: s('filterAll'), extensions: ['*'] }],
      defaultPath: readSettings().lastDir,
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const p = result.filePaths[0];
    writeSettings({ lastDir: path.dirname(p) });
    return { path: p, name: path.basename(p), base64: fs.readFileSync(p).toString('base64') };
  });

  ipcMain.handle('machsim:unpack-project', async (_e, files, projectName) => {
    if (!Array.isArray(files)) throw new Error(s('badArguments'));
    const result = await dialog.showOpenDialog(mainWindow, { title: s('unpackTitle'), properties: ['openDirectory', 'createDirectory'], defaultPath: readSettings().lastDir || app.getPath('documents') });
    if (result.canceled || !result.filePaths[0]) return null;
    const base = typeof projectName === 'string' && projectName.trim() ? projectName.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') : 'project';
    let folder = path.join(result.filePaths[0], base);
    for (let n = 2; fs.existsSync(folder); n++) folder = path.join(result.filePaths[0], `${base}_${n}`);
    fs.mkdirSync(folder, { recursive: true });
    let manifest = null;
    for (const f of files) {
      if (!f || typeof f.path !== 'string' || typeof f.base64 !== 'string') throw new Error(s('badArguments'));
      const clean = f.path.replace(/\\/g, '/');
      if (clean.startsWith('/') || /^[A-Za-z]:/.test(clean) || clean.split('/').some((p) => p === '..' || p === '')) throw new Error(s('pathNotAllowed'));
      const abs = path.normalize(path.join(folder, clean));
      if (!abs.startsWith(folder + path.sep)) throw new Error(s('pathNotAllowed'));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.from(f.base64, 'base64'));
      writablePaths.add(abs);
      if (/\.msimproj$/i.test(clean) && !clean.includes('/')) manifest = abs;
    }
    if (!manifest) throw new Error(s('badArguments'));
    projectFiles.add(manifest);
    writablePaths.add(manifest);
    addRecentProject(manifest);
    writeSettings({ lastDir: result.filePaths[0] });
    return { path: manifest, name: path.basename(manifest), folder };
  });

  ipcMain.handle('machsim:recent-projects', () => (readSettings().recentProjects || []).filter((p) => fs.existsSync(p)));

  ipcMain.handle('machsim:open-recent-project', async (_e, filePath) => {
    const recent = readSettings().recentProjects || [];
    if (!recent.includes(filePath)) throw new Error(s('notRecent'));
    return readProjectFile(filePath);
  });

  ipcMain.on('machsim:set-dirty', (_e, value) => {
    dirty = Boolean(value);
    if (mainWindow) mainWindow.setDocumentEdited(dirty);
  });

  ipcMain.on('machsim:set-dirty-documents', (_e, names) => {
    dirtyDocuments = Array.isArray(names) ? names.filter((n) => typeof n === 'string').map((n) => n.slice(0, 120)).slice(0, 50) : [];
  });

  // the renderer registers (or removes) its own close question
  ipcMain.on('machsim:close-handler', (_e, value) => {
    rendererHandlesClose = Boolean(value);
  });
  ipcMain.on('machsim:confirm-quit', () => {
    forceClose = true;
    if (mainWindow) mainWindow.close();
  });

  // ---- printing: the renderer builds the pages (print preview) in a print-only container, the
  // shell prints that page with the options the learner chose in the preview
  const printOptions = (o) => {
    const mm = o && typeof o === 'object' ? o : {};
    const w = Math.max(50, Math.min(2000, Number(mm.widthMm) || 210));
    const h = Math.max(50, Math.min(2000, Number(mm.heightMm) || 297));
    // Chromium wants the portrait size plus the landscape flag
    return { landscape: Boolean(mm.landscape), color: mm.color !== false, size: { width: Math.round(Math.min(w, h) * 1000), height: Math.round(Math.max(w, h) * 1000) } };
  };
  // ---- the system clipboard. A circuit goes there as a picture, plain text, HTML that carries the
  // circuit and, where the platform allows it next to the others, a private format. Writing a custom
  // format can replace what is already on the clipboard (each write empties it on Windows), so the
  // standard formats are written first, the private one second, and if the picture did not survive
  // the standard formats are written again; the renderer is told which formats ended up there.
  const clip64 = (v) => (typeof v === 'string' ? v : '');
  ipcMain.handle('machsim:clipboard-write', (_e, opts) => {
    const o = opts && typeof opts === 'object' ? opts : {};
    const formatName = typeof o.privateFormat === 'string' && /^[A-Za-z0-9._\/+-]{3,80}$/.test(o.privateFormat) ? o.privateFormat : '';
    const data = { text: String(o.text || '').slice(0, 2000), html: String(o.html || '') };
    const png = clip64(o.png);
    if (png) {
      const img = nativeImage.createFromBuffer(Buffer.from(png, 'base64'));
      if (!img.isEmpty()) data.image = img;
    }
    clipboard.write(data);
    if (formatName && clip64(o.privateData)) {
      try {
        clipboard.writeBuffer(formatName, Buffer.from(clip64(o.privateData), 'base64'));
        const after = clipboard.availableFormats();
        if (data.image && !after.some((f) => /^image\//i.test(f))) {
          // the private format replaced the picture: put the standard formats back (the HTML still carries the circuit)
          clipboard.write(data);
        }
      } catch {
        clipboard.write(data);
      }
    }
    return { formats: clipboard.availableFormats() };
  });
  ipcMain.handle('machsim:clipboard-read', (_e, privateFormat) => {
    const formats = clipboard.availableFormats();
    const out = { formats };
    const name = typeof privateFormat === 'string' ? privateFormat : '';
    if (name && formats.includes(name)) {
      const buf = clipboard.readBuffer(name);
      if (buf && buf.length && buf.length < 64 * 1024 * 1024) out.privateData = buf.toString('base64');
    }
    const html = clipboard.readHTML();
    if (html) out.html = html.slice(0, 64 * 1024 * 1024);
    const text = clipboard.readText();
    if (text) out.text = text.slice(0, 64 * 1024 * 1024);
    const img = clipboard.readImage();
    if (!img.isEmpty()) out.png = img.toPNG().toString('base64');
    return out;
  });
  ipcMain.handle('machsim:print-page', (_e, opts) => {
    if (!mainWindow) return { ok: false, error: 'no window' };
    const p = printOptions(opts);
    return new Promise((resolve) => {
      mainWindow.webContents.print({ silent: false, printBackground: true, color: p.color, landscape: p.landscape, margins: { marginType: 'none' }, pageSize: p.size }, (success, reason) => resolve({ ok: Boolean(success), error: success ? undefined : String(reason || '') }));
    });
  });
  ipcMain.handle('machsim:print-pdf', async (_e, opts) => {
    if (!mainWindow) return null;
    const p = printOptions(opts);
    const o = opts && typeof opts === 'object' ? opts : {};
    const data = await mainWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } });
    const suggested = typeof o.suggestedName === 'string' && o.suggestedName.trim() ? o.suggestedName.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_') : 'MachSim.pdf';
    const result = await dialog.showSaveDialog(mainWindow, {
      title: s('pdfTitle'),
      defaultPath: path.join(readSettings().lastDir || app.getPath('documents'), /\.pdf$/i.test(suggested) ? suggested : `${suggested}.pdf`),
      filters: [{ name: s('filterPdf'), extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, data);
    return { path: result.filePath, name: path.basename(result.filePath) };
  });

  ipcMain.on('machsim:set-language', (_e, value) => {
    if (value === 'vi' || value === 'en') {
      lang = value;
      if (readSettings().lang !== value) writeSettings({ lang: value });
    }
  });

  ipcMain.on('machsim:set-title', (_e, title) => {
    if (mainWindow && typeof title === 'string') mainWindow.setTitle(title.slice(0, 200));
  });

  ipcMain.handle('machsim:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    userData: app.getPath('userData'),
  }));

  // ---- component tools: part databases in the user-data folder, SPICE includes of opened model files
  ipcMain.handle('machsim:userdata-read', async (_e, name) => {
    const file = userDataFile(name);
    if (!file) throw new Error(s('badArguments'));
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  });

  ipcMain.handle('machsim:userdata-write', async (_e, name, content) => {
    const file = userDataFile(name);
    if (!file || typeof content !== 'string' || content.length > 64 * 1024 * 1024) throw new Error(s('badArguments'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // write a temporary file first so a crash never leaves half a database
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, file);
  });

  ipcMain.handle('machsim:read-include', async (_e, basePath, rel) => {
    if (typeof basePath !== 'string' || typeof rel !== 'string' || !writablePaths.has(basePath)) throw new Error(s('pathNotAllowed'));
    const clean = rel.trim().replace(/^["']|["']$/g, '');
    if (!clean || path.isAbsolute(clean) || /^[A-Za-z]:/.test(clean) || !SPICE_INCLUDE_EXT.test(clean)) return null;
    const abs = path.normalize(path.join(path.dirname(basePath), clean));
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile() || fs.statSync(abs).size > 16 * 1024 * 1024) return null;
    // an included file may include further files relative to itself
    writablePaths.add(abs);
    return { path: abs, name: path.basename(abs), content: fs.readFileSync(abs, 'utf8') };
  });
}

/** SPICE text files an opened model file may include (no other files are served). */
const SPICE_INCLUDE_EXT = /\.(lib|mod|inc|cir|sp|spi|sub|txt|model|ckt|net)$/i;

/** File of a named user-data item ('partdb-user' ...) or null for a bad name. */
function userDataFile(name) {
  if (typeof name !== 'string' || !/^[a-z0-9-]{1,40}$/.test(name)) return null;
  return path.join(app.getPath('userData'), 'databases', `${name}.json`);
}

// ---------------------------------------------------------------- command-line batch mode
const BATCH_SPICE_EXT = /\.(lib|mod|inc|cir|sp|spi|sub|txt|model|ckt|net)$/i;

function batchPath(p) {
  if (typeof p !== 'string' || !p) throw new Error(s('badArguments'));
  const abs = path.resolve(BATCH_CWD, p);
  if (!batchPaths.has(abs)) throw new Error(s('pathNotAllowed'));
  return abs;
}

function registerBatchIpc() {
  ipcMain.handle('machsim:batch-job', () => (BATCH ? { args: USER_ARGS, cwd: BATCH_CWD } : null));
  // file errors are returned as { error } (a thrown error would also be logged by Electron itself)
  ipcMain.handle('machsim:batch-read', async (_e, p) => {
    try {
      if (!BATCH) throw new Error(s('pathNotAllowed'));
      const abs = batchPath(p);
      if (fs.statSync(abs).size > 64 * 1024 * 1024) throw new Error(s('badArguments'));
      return { text: fs.readFileSync(abs, 'utf8') };
    } catch (err) {
      return { error: err.message };
    }
  });
  ipcMain.handle('machsim:batch-write', async (_e, p, text) => {
    try {
      if (!BATCH || typeof text !== 'string') throw new Error(s('pathNotAllowed'));
      const abs = batchPath(p);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text, 'utf8');
      return {};
    } catch (err) {
      return { error: err.message };
    }
  });
  ipcMain.handle('machsim:batch-include', async (_e, input, rel) => {
    if (!BATCH || typeof rel !== 'string' || typeof input !== 'string' || !batchPaths.has(path.resolve(BATCH_CWD, input))) return null;
    const base = path.resolve(BATCH_CWD, input);
    const clean = rel.trim().replace(/^["']|["']$/g, '');
    if (!clean || path.isAbsolute(clean) || /^[A-Za-z]:/.test(clean) || !BATCH_SPICE_EXT.test(clean)) return null;
    const abs = path.normalize(path.join(path.dirname(base), clean));
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile() || fs.statSync(abs).size > 16 * 1024 * 1024) return null;
    return fs.readFileSync(abs, 'utf8');
  });
  ipcMain.on('machsim:batch-done', (_e, code, stdout, stderr) => {
    if (!BATCH) return;
    if (stdout) process.stdout.write(`${stdout}\n`);
    if (stderr) process.stderr.write(`${stderr}\n`);
    app.exit(Number.isInteger(code) ? code : 1);
  });
}

function createBatchWindow() {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    process.stderr.write(`MachSim batch: renderer gone (${d.reason})\n`);
    app.exit(1);
  });
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error') process.stderr.write(`${details.message}\n`);
  });
  const limit = Number(process.env.MACHSIM_BATCH_TIMEOUT || 3600) * 1000;
  setTimeout(() => {
    process.stderr.write('MachSim batch: timed out\n');
    app.exit(1);
  }, limit).unref();
  win.loadURL(`${SCHEME}://${HOST}/index.html?batch=1`);
}

// ---------------------------------------------------------------- window
function createWindow() {
  const state = readSettings().window || {};
  mainWindow = new BrowserWindow({
    width: state.width || 1440,
    height: state.height || 900,
    x: state.x,
    y: state.y,
    minWidth: 960,
    minHeight: 600,
    title: 'MachSim',
    backgroundColor: '#eef0f3',
    show: false,
    paintWhenInitiallyHidden: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  if (state.maximized) mainWindow.maximize();

  if (SMOKE) {
    mainWindow.webContents.on('console-message', (details) => {
      if (details.level === 'error') smokeErrors.push(details.message);
    });
    mainWindow.webContents.on('render-process-gone', (_e, d) => smokeErrors.push(`renderer gone: ${d.reason}`));
  } else {
    mainWindow.once('ready-to-show', () => mainWindow.show());
    // a crashed renderer is reloaded once; it then offers the autosaved design (session-info)
    let reloaded = false;
    mainWindow.webContents.on('render-process-gone', (_e, d) => {
      if (d.reason === 'clean-exit' || !mainWindow) return;
      rendererCrashed = true;
      if (!reloaded) {
        reloaded = true;
        mainWindow.reload();
      }
    });
  }

  // Lock navigation to the app origin; open external links in the system browser.
  const allowedOrigin = DEV_URL ? new URL(DEV_URL).origin : `${SCHEME}://${HOST}`;
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== allowedOrigin) {
      event.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    const b = mainWindow.getNormalBounds();
    writeSettings({ window: { ...b, maximized: mainWindow.isMaximized() } });
    if (dirty && !forceClose) {
      // the renderer lists the unsaved documents and offers Save all / Don't save / Cancel
      if (rendererHandlesClose && !mainWindow.webContents.isCrashed()) {
        event.preventDefault();
        mainWindow.webContents.send('machsim:close-request');
        return;
      }
      const several = dirtyDocuments.length > 1;
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        buttons: [s('quitWithoutSaving'), s('cancel')],
        defaultId: 1,
        cancelId: 1,
        title: 'MachSim',
        message: s('unsavedMessage'),
        detail: several ? [s('unsavedListMessage', { n: dirtyDocuments.length }), ...dirtyDocuments, '', s('unsavedDetail')].join(String.fromCharCode(10)) : s('unsavedDetail'),
      });
      if (choice !== 0) event.preventDefault();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (SMOKE) {
      // Automated check: wait for React to render, report text + console errors, then quit.
      setTimeout(async () => {
        const text = await mainWindow.webContents.executeJavaScript(
          'JSON.stringify({ title: document.title, bridge: !!window.machsimDesktop, text: document.body.innerText.slice(0, 400) })',
        );
        // Code-split chunks (instrument panels, Grapher, dialogs, help, breadboard) load on demand:
        // follow every chunk the entry references and import it, so a chunk that cannot load
        // under app:// fails the smoke test instead of a learner's first click.
        const chunks = await mainWindow.webContents.executeJavaScript(`(async () => {
          const entry = document.querySelector('script[type=module][src]');
          if (!entry) return JSON.stringify({ chunks: 0, failed: [] });
          const seen = new Set();
          const queue = [entry.src];
          const failed = [];
          while (queue.length) {
            const url = queue.shift();
            if (seen.has(url)) continue;
            seen.add(url);
            try {
              const code = await (await fetch(url)).text();
              for (const m of code.matchAll(/assets\\/[\\w.-]+\\.js/g)) {
                const next = new URL('/' + m[0], location.href).href;
                if (!seen.has(next)) queue.push(next);
              }
            } catch (e) {
              failed.push(url + ': ' + e.message);
            }
          }
          for (const url of seen) {
            if (/worker/i.test(url)) continue;
            try {
              await import(url);
            } catch (e) {
              failed.push(url + ': ' + e.message);
            }
          }
          return JSON.stringify({ chunks: seen.size, failed });
        })()`);
        try {
          for (const f of JSON.parse(chunks).failed) smokeErrors.push(`chunk failed to load: ${f}`);
        } catch {
          smokeErrors.push(`chunk check failed: ${chunks}`);
        }
        const report = `MACHSIM_SMOKE ${text}
MACHSIM_SMOKE_CHUNKS ${chunks}
MACHSIM_SMOKE_ERRORS ${JSON.stringify(smokeErrors)}
`;
        process.stdout.write(report);
        if (process.env.MACHSIM_SMOKE_OUT) fs.writeFileSync(process.env.MACHSIM_SMOKE_OUT, report, 'utf8');
        endSession();
        app.exit(smokeErrors.length ? 2 : 0);
      }, Number(process.env.MACHSIM_SMOKE_WAIT || 3000));
    }
    if (pendingOpen) {
      const p = pendingOpen;
      pendingOpen = null;
      sendOpenFile(p);
    }
  });

  if (DEV_URL) {
    mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadURL(`${SCHEME}://${HOST}/index.html`);
  }
}

// ---------------------------------------------------------------- lifecycle
if (BATCH) {
  // a batch run never touches the interactive instance: own profile folder, no instance lock
  app.setPath('userData', path.join(app.getPath('temp'), `MachSim-batch-${process.pid}`));
  app.disableHardwareAcceleration();
  app.on('will-quit', () => {
    try {
      fs.rmSync(app.getPath('userData'), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    registerAppProtocol();
    registerIpc();
    registerBatchIpc();
    createBatchWindow();
  });
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const f = fileFromArgv(argv);
    if (f) sendOpenFile(f);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // The renderer draws its own menu bar; keep only devtools/reload accelerators in dev.
    Menu.setApplicationMenu(null);
    const saved = readSettings().lang;
    if (saved === 'vi' || saved === 'en') lang = saved;
    registerAppProtocol();
    registerIpc();
    registerBatchIpc();
    beginSession();
    pendingOpen = fileFromArgv(process.argv);
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('will-quit', () => endSession());
}
