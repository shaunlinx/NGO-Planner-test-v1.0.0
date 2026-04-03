const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ngoPlannerProjectIntel', {
  reportSelection: async (payload) => {
    try {
      return await ipcRenderer.invoke('project-intel-save-selection', payload);
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
});

