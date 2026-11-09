// Preload bridge for the UI: the only surface the renderer sees. CommonJS
// (.cjs) because sandboxed preload scripts cannot use ESM.
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, adapt) {
  const handler = (_event, payload) => adapt(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('dronepath', {
  pickRecording: (request) => ipcRenderer.invoke('dronepath:pick', request),
  getSession: () => ipcRenderer.invoke('dronepath:session'),
  getSettings: () => ipcRenderer.invoke('dronepath:settings'),
  saveSettings: (patch) => ipcRenderer.invoke('dronepath:settings:save', patch),
  pickExportOutput: () => ipcRenderer.invoke('dronepath:export:pick-output'),
  pickTelemetryOutput: () => ipcRenderer.invoke('dronepath:telemetry:pick-output'),
  saveTelemetryJson: (request) => ipcRenderer.invoke('dronepath:telemetry:save', request),
  startExport: (request) => ipcRenderer.invoke('dronepath:export:start', request),
  cancelExport: () => ipcRenderer.invoke('dronepath:export:cancel'),
  revealExportOutput: (payload) => ipcRenderer.invoke('dronepath:export:reveal', payload),
  openExportOutput: (payload) => ipcRenderer.invoke('dronepath:export:open', payload),
  onExportProgress: (cb) => subscribe('dronepath:export:progress', cb),
  onExportCapture: (cb) => subscribe('dronepath:export:capture', cb),
  onExportDone: (cb) => subscribe('dronepath:export:done', cb),
  onPreparing: (cb) => subscribe('dronepath:preparing', () => cb()),
  onPrepareProgress: (cb) => subscribe('dronepath:preparing:progress', cb),
  onUpdateReady: (cb) => subscribe('dronepath:update:ready', () => cb()),
  onUpdateRestartFailed: (cb) =>
    subscribe('dronepath:update:restart-failed', (message) => cb(message)),
  getUpdateState: () => ipcRenderer.invoke('dronepath:update:state'),
  restartToUpdate: () => ipcRenderer.invoke('dronepath:update:restart'),
});
