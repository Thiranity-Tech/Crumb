const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('crumbDesktop', {
  readDb: () => ipcRenderer.invoke('local-db:read'),
  writeDb: b => ipcRenderer.invoke('local-db:write', b),
  backup: () => ipcRenderer.invoke('local-db:backup'),
  printInvoice: html => ipcRenderer.invoke('invoice:print', html),
  saveInvoicePdf: data => ipcRenderer.invoke('invoice:save-pdf', data)
})
