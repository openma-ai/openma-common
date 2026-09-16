export class DaemonConnection {
    #options;
    #socket = null;
    #stopped = true;
    #backoffMs = 1_000;
    #heartbeat = null;
    #reconnect = null;
    constructor(options) { this.#options = options; }
    start() {
        if (!this.#stopped)
            return;
        this.#stopped = false;
        this.#backoffMs = 1_000;
        this.#attach();
    }
    stop() { this.#finish("stopped"); }
    send(message) {
        return this.#socket ? this.#send(this.#socket, message) : false;
    }
    #attach() {
        if (this.#stopped)
            return;
        this.#options.onState?.("connecting");
        // The embedding host may cancel in response to the state notification.
        if (this.#stopped)
            return;
        let socket;
        try {
            socket = this.#options.openSocket();
        }
        catch {
            this.#retry();
            return;
        }
        this.#socket = socket;
        let lastPongAt = Date.now();
        const current = () => !this.#stopped && this.#socket === socket;
        // Also bounds a TCP/TLS/WebSocket handshake that never opens.
        this.#heartbeat = setInterval(() => {
            if (!current())
                return;
            if (Date.now() - lastPongAt >= 75_000) {
                this.#drop(socket);
                return;
            }
            if (socket.readyState === 1)
                this.#send(socket, { type: "ping" });
        }, 25_000);
        socket.on("open", () => {
            if (!current())
                return;
            lastPongAt = Date.now();
            // A channel is pinned to this socket. Delayed agent discovery must never
            // publish its greeting onto a subsequent connection.
            try {
                void this.#options.onOpen({ send: (message) => this.#send(socket, message) })
                    .catch(() => this.#drop(socket));
            }
            catch {
                this.#drop(socket);
            }
        });
        socket.on("message", (data) => {
            if (!current())
                return;
            let message;
            try {
                const parsed = JSON.parse(typeof data === "string" ? data : data.toString());
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
                    return;
                message = parsed;
            }
            catch {
                return;
            }
            if (message.type === "pong") {
                lastPongAt = Math.max(lastPongAt, Date.now());
                return;
            }
            if (message.type === "welcome") {
                this.#backoffMs = 1_000;
                this.#options.onState?.("online");
                if (!current())
                    return;
            }
            this.#options.onMessage(message);
        });
        socket.on("unexpected-response", (_request, response) => {
            response.resume?.();
            if (!current())
                return;
            if (response.statusCode === 409)
                this.#finish("occupied");
            else if ([401, 403, 404].includes(response.statusCode ?? 0))
                this.#finish("expired");
            else
                this.#drop(socket);
        });
        socket.on("error", () => this.#drop(socket));
        socket.on("close", () => this.#drop(socket));
    }
    #send(socket, message) {
        if (this.#stopped || this.#socket !== socket || socket.readyState !== 1)
            return false;
        try {
            socket.send(JSON.stringify(message));
            return true;
        }
        catch {
            this.#drop(socket);
            return false;
        }
    }
    #closeSocket() {
        if (this.#heartbeat !== null)
            clearInterval(this.#heartbeat);
        this.#heartbeat = null;
        const socket = this.#socket;
        this.#socket = null;
        // Clear ownership before closing; close/error may fire synchronously.
        if (!socket || socket.readyState === 3)
            return;
        try {
            if (socket.terminate)
                socket.terminate();
            else
                socket.close(1000, "daemon connection closed");
        }
        catch { /* Already closed. Its callbacks are fenced by socket identity. */ }
    }
    #drop(socket) {
        if (this.#stopped || this.#socket !== socket)
            return;
        this.#closeSocket();
        this.#retry();
    }
    #retry() {
        if (this.#stopped || this.#reconnect !== null)
            return;
        this.#options.onState?.("offline");
        if (this.#stopped)
            return;
        const delay = this.#backoffMs;
        this.#backoffMs = Math.min(delay * 2, 60_000);
        this.#reconnect = setTimeout(() => {
            this.#reconnect = null;
            this.#attach();
        }, delay);
    }
    #finish(state) {
        if (this.#stopped)
            return;
        this.#stopped = true;
        if (this.#reconnect !== null)
            clearTimeout(this.#reconnect);
        this.#reconnect = null;
        this.#closeSocket();
        this.#options.onState?.(state);
    }
}
//# sourceMappingURL=daemon-connection.js.map