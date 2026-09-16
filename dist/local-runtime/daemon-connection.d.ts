/** Transport boundary shared by the standalone and desktop daemon hosts. */
export interface DaemonSocket {
    readyState: number;
    on(event: string, listener: (...args: any[]) => void): this;
    send(payload: string): void;
    close(code?: number, reason?: string): void;
    terminate?(): void;
}
export type DaemonConnectionState = "connecting" | "online" | "offline" | "occupied" | "expired" | "stopped";
export interface DaemonChannel {
    /** False if this connection has been replaced, closed, or stopped. */
    send(message: Record<string, unknown>): boolean;
}
export interface DaemonConnectionOptions {
    openSocket(): DaemonSocket;
    onOpen(channel: DaemonChannel): Promise<void>;
    onMessage(message: Record<string, unknown>): void;
    onState?(state: DaemonConnectionState): void;
}
export declare class DaemonConnection {
    #private;
    constructor(options: DaemonConnectionOptions);
    start(): void;
    stop(): void;
    send(message: Record<string, unknown>): boolean;
}
//# sourceMappingURL=daemon-connection.d.ts.map