"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBridgeClient = createBridgeClient;
const scanner_1 = require("../../core/scanner");
function createBridgeClient(bridge) {
    const activeBridge = bridge ?? (typeof window !== 'undefined' ? window.fileUnlocker : undefined);
    if (!activeBridge) {
        throw new scanner_1.ReadableException('当前运行环境不支持文件解除占用能力');
    }
    return activeBridge;
}
