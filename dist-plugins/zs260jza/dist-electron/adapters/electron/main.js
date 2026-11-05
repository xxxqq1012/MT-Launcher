"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const lock_1 = require("../../core/lock");
const windows_1 = require("../platform/windows");
const service = (0, lock_1.createLockService)({
    scan: windows_1.scanWindowsPath,
    killProcesses: windows_1.killWindowsProcesses,
});
const activeScans = new Map();
function createWindow() {
    const win = new electron_1.BrowserWindow({
        width: 1080,
        height: 720,
        minWidth: 920,
        minHeight: 640,
        frame: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: node_path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    win.loadFile(node_path_1.default.join(__dirname, '../../../utos-plugin/dist/index.html'));
}
electron_1.ipcMain.handle('fileUnlocker:selectPath', async () => {
    const result = await electron_1.dialog.showOpenDialog({
        properties: ['openFile', 'openDirectory'],
    });
    return result.canceled ? undefined : result.filePaths[0];
});
electron_1.ipcMain.handle('fileUnlocker:scanPath', async (_event, targetPath, options) => {
    const controller = options?.scanId ? new AbortController() : undefined;
    if (options?.scanId && controller) {
        activeScans.set(options.scanId, controller);
    }
    try {
        return await service.scanPath(targetPath, {
            recursive: options?.recursive,
            signal: controller?.signal,
        });
    }
    finally {
        if (options?.scanId) {
            activeScans.delete(options.scanId);
        }
    }
});
electron_1.ipcMain.handle('fileUnlocker:cancelScan', (_event, scanId) => {
    activeScans.get(scanId)?.abort();
    activeScans.delete(scanId);
});
electron_1.ipcMain.handle('fileUnlocker:killAndRescan', (_event, targetPath, pids, options) => service.killAndRescan(targetPath, pids, { recursive: options?.recursive }));
electron_1.ipcMain.handle('fileUnlocker:controlWindow', (event, action) => {
    const win = electron_1.BrowserWindow.fromWebContents(event.sender);
    if (!win) {
        return;
    }
    if (action === 'minimize') {
        win.minimize();
        return;
    }
    if (action === 'maximize') {
        win.isMaximized() ? win.unmaximize() : win.maximize();
        return;
    }
    win.close();
});
electron_1.app.whenReady().then(() => {
    electron_1.Menu.setApplicationMenu(null);
    createWindow();
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
