const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectFile: (filters) => ipcRenderer.invoke('select-file', filters),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  uploadFrameIo: (data) => ipcRenderer.invoke('upload-frameio', data),
  backupDrive: (data) => ipcRenderer.invoke('backup-drive', data)
});
