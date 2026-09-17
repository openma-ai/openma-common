import { type ArtifactOptions } from "./shared.js";
export interface UvxAcpRelease {
    schema: "openma.acp.uvx.v1";
    id: string;
    version: string;
    package: string;
    command: string;
    python: string;
    indexUrl: string;
    hashes: string[];
    args: string[];
    env: Record<string, string>;
    digest: string;
}
export interface UvxAcpReleaseInput {
    id: string;
    version: string;
    package: string;
    command?: string;
    python?: string;
    indexUrl?: string;
    args?: string[];
    env?: Record<string, string>;
}
export declare function resolveUvxAcpRelease(input: UvxAcpReleaseInput, options?: ArtifactOptions): Promise<UvxAcpRelease>;
export declare function validateUvxAcpRelease(value: unknown): UvxAcpRelease;
export declare function prepareUvxAcpRelease(input: UvxAcpRelease, options: ArtifactOptions & {
    root: string;
}): Promise<import("./shared.js").Launch & {
    release: UvxAcpRelease;
}>;
//# sourceMappingURL=uvx.d.ts.map