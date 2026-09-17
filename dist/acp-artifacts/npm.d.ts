export interface NpmAcpRelease {
    schema: "openma.acp.npm.v1";
    id: string;
    version: string;
    package: string;
    tarball: string;
    integrity: string;
    bin: string;
    digest: string;
}
export interface NpmAcpReleaseSelection {
    id: string;
    version: string;
    package: string;
}
export interface NpmAcpReleaseOptions {
    fetch?: typeof fetch;
    signal?: AbortSignal;
}
export interface PreparedAcpRelease {
    command: string;
    release: NpmAcpRelease;
}
/** Validate persisted release records before trusting their paths or digest. */
export declare function validateNpmAcpRelease(value: unknown): NpmAcpRelease;
/** Read the release's own identity and integrity from npm; never resolve latest. */
export declare function resolveNpmAcpRelease(selection: NpmAcpReleaseSelection, options?: NpmAcpReleaseOptions): Promise<NpmAcpRelease>;
/** Prepare inside the host/sandbox. Atomic publication prevents partial installs
 * from becoming launchable. Version directories are never upgraded in place. */
export declare function prepareNpmAcpRelease(input: NpmAcpRelease, options: NpmAcpReleaseOptions & {
    root: string;
}): Promise<PreparedAcpRelease>;
//# sourceMappingURL=npm.d.ts.map