"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLockService = createLockService;
const process_1 = require("./process");
function createLockService(adapter) {
    return {
        scanPath(path, options) {
            return adapter.scan(path, options);
        },
        async killAndRescan(path, pids, options) {
            const killResults = await adapter.killProcesses(pids);
            const summary = (0, process_1.buildKillSummary)(killResults);
            const rescan = await adapter.scan(path, options);
            return {
                killResults,
                summary,
                rescan,
            };
        },
    };
}
