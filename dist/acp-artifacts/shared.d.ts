export interface ArtifactOptions {
    fetch?: typeof fetch;
    signal?: AbortSignal;
}
export interface Launch {
    command: string;
    args?: string[];
    env?: Record<string, string>;
}
export declare function digest(value: unknown): string;
export declare function record(value: unknown): value is Record<string, unknown>;
export declare function pinnedVersion(value: unknown): value is string;
export declare function identity(id: unknown, version: unknown): void;
export declare function safeRelative(value: unknown): string;
export declare function url(value: unknown, loopback?: boolean): string;
export declare function launchOptions(value: {
    args?: unknown;
    env?: unknown;
}): {
    args: string[];
    env: Record<string, string>;
};
export declare function childEnvironment(): NodeJS.ProcessEnv;
export declare function timeout(signal?: AbortSignal, ms?: number): AbortSignal;
export declare function download(address: string, options: ArtifactOptions): Promise<Buffer>;
export declare function platformKey(): string;
/** Move a finished install into place. Windows MoveFileEx returns EPERM when the
 * destination directory already exists, and briefly while a scanner holds a new file. */
export declare function publishDirectory(staging: string, destination: string): Promise<void>;
export declare function discardStaging(staging: string, destination: string): Promise<void>;
export declare function installAtomically<R extends {
    digest: string;
}>(root: string, release: R, build: (directory: string) => Promise<void>, inspect: (directory: string) => Promise<Launch>, signal?: AbortSignal): Promise<Launch & {
    release: R;
}>;
//# sourceMappingURL=shared.d.ts.map