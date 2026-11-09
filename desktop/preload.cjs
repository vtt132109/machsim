/**
 * Preload bridge: exposes a minimal, typed file API as window.machsimDesktop
 * (see src/desktop/bridge.ts for the renderer-side types).
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('machsimDesktop', {
  isDesktop: true,
  platform: process.platform,
  /** Native open dialog. opts.spice = true to pick SPICE netlists. Resolves { path, name, content } or null. */
  openFile: (opts) => ipcRenderer.invoke('machsim:open-dialog', opts || {}),
  /** Native save-as dialog writing `content`. Resolves { path, name } or null when cancelled. */
  saveFileAs: (content, opts) => ipcRenderer.invoke('machsim:save-dialog', { ...(opts || {}), content }),
  /** Overwrite a file previously opened or chosen by the user (opts.backups: .bak copies to keep). */
  writeFile: (filePath, content, opts) => ipcRenderer.invoke('machsim:write-file', filePath, content, opts || {}),
  /** Size and dates of a file opened or saved this session (File > File information). */
  fileStat: (filePath) => ipcRenderer.invoke('machsim:file-stat', filePath),
  /** Crash recovery: autosave slot in the user-data folder, and how the previous run ended. */
  recoveryRead: () => ipcRenderer.invoke('machsim:recovery-read'),
  recoveryWrite: (text) => ipcRenderer.invoke('machsim:recovery-write', text === null ? null : String(text)),
  sessionInfo: () => ipcRenderer.invoke('machsim:session-info'),
  /** Export text or base64 binary through a save dialog. */
  exportFile: (opts) => ipcRenderer.invoke('machsim:save-binary', opts || {}),
  recentFiles: () => ipcRenderer.invoke('machsim:recent'),
  openRecent: (filePath) => ipcRenderer.invoke('machsim:open-recent', filePath),
  setDirty: (value) => ipcRenderer.send('machsim:set-dirty', Boolean(value)),
  setTitle: (title) => ipcRenderer.send('machsim:set-title', String(title)),
  info: () => ipcRenderer.invoke('machsim:info'),
  /** Projects (.msimproj): open / save-as dialogs, files by path relative to the project folder. */
  openProject: () => ipcRenderer.invoke('machsim:open-project'),
  saveProjectAs: (content, suggestedName) => ipcRenderer.invoke('machsim:save-project-as', content, suggestedName),
  readProjectFile: (projectPath, rel) => ipcRenderer.invoke('machsim:project-read', projectPath, rel),
  writeProjectFile: (projectPath, rel, base64) => ipcRenderer.invoke('machsim:project-write', projectPath, rel, base64),
  projectFileExists: (projectPath, rel) => ipcRenderer.invoke('machsim:project-exists', projectPath, rel),
  addFileToProject: (projectPath) => ipcRenderer.invoke('machsim:project-add-file', projectPath),
  openBinaryFile: (opts) => ipcRenderer.invoke('machsim:open-binary', opts || {}),
  unpackProject: (files, projectName) => ipcRenderer.invoke('machsim:unpack-project', files, projectName),
  recentProjects: () => ipcRenderer.invoke('machsim:recent-projects'),
  openRecentProject: (filePath) => ipcRenderer.invoke('machsim:open-recent-project', filePath),
  /** Part databases (user-data folder) and SPICE includes of model files opened this session. */
  readUserData: (name) => ipcRenderer.invoke('machsim:userdata-read', name),
  writeUserData: (name, content) => ipcRenderer.invoke('machsim:userdata-write', name, content),
  readIncludeFile: (basePath, rel) => ipcRenderer.invoke('machsim:read-include', basePath, rel),
  /** Command-line batch mode (MachSim.exe --batch …): null / refused outside batch mode. */
  batchJob: () => ipcRenderer.invoke('machsim:batch-job'),
  batchRead: (filePath) => ipcRenderer.invoke('machsim:batch-read', filePath),
  batchWrite: (filePath, text) => ipcRenderer.invoke('machsim:batch-write', filePath, text),
  batchInclude: (input, rel) => ipcRenderer.invoke('machsim:batch-include', input, rel),
  batchDone: (code, stdout, stderr) => ipcRenderer.send('machsim:batch-done', Number(code), String(stdout ?? ''), String(stderr ?? '')),
  /** UI language of the renderer ('vi' | 'en'): the native dialogs of the shell follow it. */
  setLanguage: (lang) => ipcRenderer.send('machsim:set-language', String(lang)),
  /** Files opened from Explorer / command line / second instance. Returns an unsubscribe function. */
  onOpenFile: (callback) => {
    const listener = (_event, file) => callback(file);
    ipcRenderer.on('machsim:open-file', listener);
    return () => ipcRenderer.removeListener('machsim:open-file', listener);
  },
});
