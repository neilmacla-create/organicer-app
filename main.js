const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const axios = require('axios');
const { google } = require('googleapis');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 750,
    resizable: true,
    backgroundColor: '#141416',
    title: 'Organicer',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function parseDriveFolderId(input) {
  if (!input) return null;
  const match = input.match(/folders\/([a-zA-Z0-9_-]+)/) || input.match(/id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : input.trim();
}

function parseFrameIoAssetId(input) {
  if (!input) return null;
  const match = input.match(/assets\/([a-f0-9-]+)/i) || input.match(/projects\/([a-f0-9-]+)/i);
  return match ? match[1] : input.trim();
}

ipcMain.handle('select-file', async (event, filters) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters || [{ name: 'All Files', extensions: ['*'] }]
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('upload-frameio', async (event, { filePath, frameUrl, apiToken }) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: 'Selected video file does not exist.' };
    }
    if (!frameUrl) {
      return { success: false, error: 'Frame.io link is required.' };
    }

    const folderId = parseFrameIoAssetId(frameUrl);
    if (!folderId) return { success: false, error: 'Invalid Frame.io share URL or ID.' };

    if (!apiToken) {
      await new Promise(r => setTimeout(r, 1500));
      return { 
        success: true, 
        message: '[Organicer] Draft upload completed (Simulation Mode). Add API Token in Settings for live sync.',
        assetId: 'sim_' + Date.now()
      };
    }

    const fileStats = fs.statSync(filePath);
    const fileName = path.basename(filePath);

    const createRes = await axios.post(
      `https://api.frame.io/v2/assets/${folderId}/children`,
      { name: fileName, type: "file", filesize: fileStats.size },
      { headers: { Authorization: `Bearer ${apiToken}` } }
    );

    const asset = createRes.data;
    const uploadUrl = asset.upload_urls[0];

    const fileBuffer = fs.readFileSync(filePath);
    await axios.put(uploadUrl, fileBuffer, {
      headers: { 'Content-Type': 'video/mp4' }
    });

    return { success: true, message: '[Organicer] Uploaded successfully to Frame.io!', assetId: asset.id };
  } catch (err) {
    return { success: false, error: err.response?.data?.message || err.message };
  }
});

ipcMain.handle('backup-drive', async (event, { projectPath, driveUrl, serviceAccountJson }) => {
  let tempZipPath = null;
  try {
    if (!projectPath || !fs.existsSync(projectPath)) {
      return { success: false, error: 'Project folder does not exist.' };
    }
    if (!driveUrl) {
      return { success: false, error: 'Google Drive folder link is required.' };
    }

    const driveFolderId = parseDriveFolderId(driveUrl);
    if (!driveFolderId) return { success: false, error: 'Invalid Google Drive folder link.' };

    const projectName = path.basename(projectPath);
    tempZipPath = path.join(app.getPath('temp'), `${projectName}_Organicer_Backup_${Date.now()}.zip`);
    
    const output = fs.createWriteStream(tempZipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.directory(projectPath, false);
      archive.finalize();
    });

    if (!serviceAccountJson) {
      if (fs.existsSync(tempZipPath)) fs.unlinkSync(tempZipPath);
      return {
        success: true,
        message: `[Organicer] Project zipped & backed up to Drive (Simulation Mode). Add Service Account credentials in Settings for live API sync.`,
        fileId: 'sim_drive_' + Date.now()
      };
    }

    const credentials = JSON.parse(serviceAccountJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.file']
    });
    const drive = google.drive({ version: 'v3', auth });

    const fileMetadata = {
      name: path.basename(tempZipPath),
      parents: [driveFolderId]
    };
    const media = {
      mimeType: 'application/zip',
      body: fs.createReadStream(tempZipPath)
    };

    const res = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, webViewLink'
    });

    if (fs.existsSync(tempZipPath)) fs.unlinkSync(tempZipPath);

    return { 
      success: true, 
      message: '[Organicer] Project ZIP successfully backed up to Google Drive!', 
      fileId: res.data.id,
      link: res.data.webViewLink 
    };

  } catch (err) {
    if (tempZipPath && fs.existsSync(tempZipPath)) fs.unlinkSync(tempZipPath);
    return { success: false, error: err.message };
  }
});
