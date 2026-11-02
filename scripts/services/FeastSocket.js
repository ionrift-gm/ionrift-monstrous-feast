import { MODULE_ID } from "../data/moduleId.js";

export const SOCKET_CHANNEL = `module.${MODULE_ID}`;

/**
 * Centralized socket transport facade for Ionrift Monstrous Feast.
 * Isolates all module socket channel listeners and emissions in one module
 * while preserving the action-keyed wire payload contract across services.
 */
export class FeastSocket {
    static isAvailable() {
        return Boolean(globalThis.game?.socket);
    }

    static createKernelSocket(options = {}) {
        const createSocket = globalThis.game?.ionrift?.library?.createSocket;
        return typeof createSocket === "function" ? createSocket(MODULE_ID, options) : null;
    }

    static on(handler) {
        if (typeof handler !== "function") return false;
        const socket = globalThis.game?.socket;
        if (!socket?.on) return false;
        socket.on(SOCKET_CHANNEL, handler);
        return true;
    }

    static off(handler) {
        if (typeof handler !== "function") return;
        globalThis.game?.socket?.off?.(SOCKET_CHANNEL, handler);
    }

    static emit(payload) {
        if (!payload || typeof payload !== "object") return false;
        const socket = globalThis.game?.socket;
        if (!socket?.emit) return false;
        socket.emit(SOCKET_CHANNEL, payload);
        return true;
    }
}
