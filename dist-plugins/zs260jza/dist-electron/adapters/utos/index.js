"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("../shared/bridge");
const lock_1 = require("../../core/lock");
const windows_1 = require("../platform/windows");
const service = (0, lock_1.createLockService)({
    scan: windows_1.scanWindowsPath,
    killProcesses: windows_1.killWindowsProcesses,
});
let initialPath;
function readPayloadPath(payload) {
    if (typeof payload === 'string') {
        return payload;
    }
    if (Array.isArray(payload)) {
        for (const item of payload) {
            const itemPath = readPayloadPath(item);
            if (itemPath) {
                return itemPath;
            }
        }
        return undefined;
    }
    if (payload && typeof payload === 'object') {
        const record = payload;
        if (typeof record.path === 'string') {
            return record.path;
        }
        if (typeof record.filePath === 'string') {
            return record.filePath;
        }
        return readPayloadPath(record.files);
    }
    return undefined;
}
window.utools?.onPluginEnter?.((action) => {
    if (action.type !== 'files') {
        return;
    }
    // 接收超级面板传入的文件或文件夹路径，页面已加载时立即通知，未加载时先缓存。
    const selectedPath = readPayloadPath(action.payload);
    if (!selectedPath) {
        return;
    }
    initialPath = selectedPath;
    window.dispatchEvent(new CustomEvent('fileUnlocker:pathSelected', { detail: { path: selectedPath } }));
});
window.fileUnlocker = {
    async selectPath() {
        // MT 兼容层：走宿主 uTools shim 的文件/文件夹选择对话框（取消或失败时返回 undefined）
        const host = window.utools;
        if (host && typeof host.showOpenDialog === 'function') {
            try {
                const picked = await host.showOpenDialog({
                    title: '选择文件或文件夹',
                    properties: ['openFile', 'openDirectory'],
                });
                if (Array.isArray(picked) && picked.length > 0) {
                    return picked[0];
                }
            }
            catch (error) {
                console.error('[fileUnlocker] selectPath failed:', error);
            }
        }
        return undefined;
    },
    getInitialPath() {
        return initialPath;
    },
    scanPath: service.scanPath,
    killAndRescan: service.killAndRescan,
    getPathForFile(file) {
        // MT 兼容层：优先宿主 webUtils.getPathForFile（Electron 已移除 File.path），再兜底旧属性
        const host = window.utools;
        if (host && typeof host.getPathForFile === 'function') {
            try {
                const picked = host.getPathForFile(file);
                if (picked) {
                    return picked;
                }
            }
            catch (error) {
                console.error('[fileUnlocker] getPathForFile failed:', error);
            }
        }
        const dragFile = file;
        return dragFile.path || file.webkitRelativePath || undefined;
    },
};
