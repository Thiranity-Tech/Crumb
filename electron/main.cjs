const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path'), fs = require('fs')
let mainWindow

function dbPath(){
  return path.join(app.getPath('userData'), 'crumb-erp-local-data.json')
}

function createWindow(){
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'WERP - Crumb & Co. ERP',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow.webContents.toggleDevTools()
    }
  })
}

app.whenReady().then(() => {
  ipcMain.handle('local-db:read', () => {
    return fs.existsSync(dbPath()) ? fs.readFileSync(dbPath()).toString('base64') : null
  })

  ipcMain.handle('local-db:write', (_, base64) => {
    try {
      const dir = app.getPath('userData')
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(dbPath(), Buffer.from(base64, 'base64'))
      return true
    } catch (e) {
      console.error('Error writing local DB:', e)
      return false
    }
  })

  ipcMain.handle('local-db:backup', async () => {
    let out = await dialog.showSaveDialog(mainWindow, {
      title: 'Backup Crumb ERP data',
      defaultPath: `crumb-erp-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'Crumb ERP Backup', extensions: ['json'] }]
    })
    if (out.canceled || !out.filePath) return false
    if (fs.existsSync(dbPath())) {
      fs.copyFileSync(dbPath(), out.filePath)
    } else {
      fs.writeFileSync(out.filePath, JSON.stringify({ message: 'Empty database' }, null, 2))
    }
    return out.filePath
  })

  ipcMain.handle('invoice:print', async (_, html) => {
    const printWindow = new BrowserWindow({
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    })
    try {
      await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(String(html || '')))
      return new Promise((resolve) => {
        printWindow.webContents.print(
          { silent: false, printBackground: true },
          (success, errorType) => {
            if (!printWindow.isDestroyed()) printWindow.destroy()
            resolve({ success, errorType })
          }
        )
      })
    } catch (err) {
      if (!printWindow.isDestroyed()) printWindow.destroy()
      console.error('Print invoice error:', err)
      throw err
    }
  })

  ipcMain.handle('invoice:save-pdf', async (_, { html, defaultName }) => {
    const printWindow = new BrowserWindow({
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    })
    try {
      await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(String(html || '')))
      await new Promise(r => setTimeout(r, 300))

      const pdfData = await printWindow.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true
      })
      if (!printWindow.isDestroyed()) printWindow.destroy()

      const out = await dialog.showSaveDialog(mainWindow, {
        title: 'Save Bill PDF',
        defaultPath: defaultName || `Bill-${Date.now()}.pdf`,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
      })
      if (out.canceled || !out.filePath) return null
      fs.writeFileSync(out.filePath, pdfData)
      return out.filePath
    } catch (err) {
      if (!printWindow.isDestroyed()) printWindow.destroy()
      console.error('Save invoice PDF error:', err)
      throw err
    }
  })

  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
