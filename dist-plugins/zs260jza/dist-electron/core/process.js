"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.blockedProcessNames = void 0;
exports.markProcessRisk = markProcessRisk;
exports.buildKillSummary = buildKillSummary;
exports.blockedProcessNames = new Set([
    'system',
    'registry',
    'smss.exe',
    'csrss.exe',
    'wininit.exe',
    'services.exe',
    'lsass.exe',
]);
function markProcessRisk(processInfo, currentPid) {
    const name = processInfo.name.toLowerCase();
    const processPath = processInfo.path?.replaceAll('/', '\\').toLowerCase();
    // 先保护当前应用进程，避免用户结束自身导致操作中断。
    if (typeof currentPid === 'number' && processInfo.pid === currentPid) {
        return {
            ...processInfo,
            risk: 'blocked',
            selectable: false,
            reason: '当前应用进程不可结束',
        };
    }
    // 再保护系统关键进程，这类进程不允许被结束。
    if (processInfo.pid <= 4 || exports.blockedProcessNames.has(name)) {
        return {
            ...processInfo,
            risk: 'blocked',
            selectable: false,
            reason: '系统关键进程不可结束',
        };
    }
    // Windows 路径可能来自不同工具，统一分隔符后再判断目录风险。
    if (processPath?.startsWith('c:\\windows\\')) {
        return {
            ...processInfo,
            risk: 'warning',
            selectable: true,
            reason: 'Windows 目录下的进程需要谨慎处理',
        };
    }
    return {
        ...processInfo,
        risk: 'normal',
        selectable: true,
    };
}
function buildKillSummary(results) {
    return results.reduce((summary, result) => ({
        successCount: summary.successCount + (result.success ? 1 : 0),
        failedCount: summary.failedCount + (result.success ? 0 : 1),
    }), { successCount: 0, failedCount: 0 });
}
