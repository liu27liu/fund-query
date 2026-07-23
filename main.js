const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;
let pythonProcess = null;
let serverReady = false;

const isPackaged = app.isPackaged;

// 获取后端可执行文件路径
function getBackendPath() {
  // 打包后：使用 PyInstaller 生成的 exe
  if (isPackaged) {
    const exePath = path.join(process.resourcesPath, '..', 'backend.exe');
    if (fs.existsSync(exePath)) {
      return exePath;
    }
    // 备用路径
    const altPath = path.join(path.dirname(process.execPath), 'backend.exe');
    if (fs.existsSync(altPath)) {
      return altPath;
    }
  }
  // 开发环境：使用系统 Python
  return null;
}

// 获取 Python 路径（开发环境）
function getPythonPath() {
  if (process.platform === 'win32') {
    return 'python.exe';
  }
  return 'python3';
}

// 获取 server.py 路径
function getServerPath() {
  if (isPackaged) {
    return path.join(process.resourcesPath, 'app', 'server.py');
  }
  return path.join(__dirname, 'server.py');
}

// 启动后端服务
function startBackend() {
  const backendPath = getBackendPath();

  if (backendPath && fs.existsSync(backendPath)) {
    // 生产环境：启动 PyInstaller 打包的 exe
    console.log('Starting bundled backend:', backendPath);
    pythonProcess = spawn(backendPath, [], {
      cwd: path.dirname(backendPath),
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } else {
    // 开发环境：启动 Python 脚本
    const pythonPath = getPythonPath();
    const serverPath = getServerPath();
    console.log('Starting dev backend:', pythonPath, serverPath);
    pythonProcess = spawn(pythonPath, [serverPath], {
      cwd: isPackaged ? path.dirname(serverPath) : __dirname,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  }

  pythonProcess.stdout.on('data', (data) => {
    const msg = data.toString().trim();
    console.log('[Backend]', msg);
    if (msg.includes('Running on') || msg.includes('8080')) {
      serverReady = true;
      loadApp();
    }
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error('[Backend Error]', data.toString().trim());
  });

  pythonProcess.on('close', (code) => {
    console.log(`Backend exited with code ${code}`);
    pythonProcess = null;
  });

  // 超时回退
  setTimeout(() => {
    if (!serverReady) {
      console.log('Backend timeout, loading app anyway...');
      loadApp();
    }
  }, 10000);
}

// 创建主窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: '基金股票查询平台',
    icon: path.join(__dirname, 'assets', 'logo.jpg'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false
    },
    show: false,
    backgroundColor: '#f8fafc'
  });

  loadApp();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (!serverReady) {
      // 显示启动中提示
      mainWindow.webContents.executeJavaScript(`
        document.body.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;font-family:sans-serif;"><div style="font-size:24px;margin-bottom:16px;">🚀 基金股票查询平台</div><div style="color:#666;">服务启动中，请稍候...</div></div>';
      `);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function loadApp() {
  if (!mainWindow) return;
  if (serverReady) {
    mainWindow.loadURL('http://127.0.0.1:8080');
  } else {
    mainWindow.loadFile('index.html');
  }
}

// 应用生命周期
app.whenReady().then(() => {
  createWindow();
  startBackend();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
});

// IPC
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('show-save-dialog', async (event, options) => {
  if (!mainWindow) return { canceled: true };
  return await dialog.showSaveDialog(mainWindow, options);
});
