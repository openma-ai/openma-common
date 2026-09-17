import { type ArtifactOptions } from "./shared.js";
export type BinaryFormat = "raw" | "zip" | "tar" | "tar.gz" | "tar.bz2" | "tar.xz";
export interface BinaryAcpRelease {
    schema: "openma.acp.binary.v1";
    id: string;
    version: string;
    platform: string;
    archive: string;
    sha256: string;
    format: BinaryFormat;
    command: string;
    args: string[];
    env: Record<string, string>;
    digest: string;
}
export interface BinaryAcpReleaseInput {
    id: string;
    version: string;
    platform: string;
    archive: string;
    sha256: string;
    format?: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
}
export declare function binaryFormat(address: string): BinaryFormat;
export declare function resolveBinaryAcpRelease(input: BinaryAcpReleaseInput): BinaryAcpRelease;
export declare function validateBinaryAcpRelease(value: unknown): BinaryAcpRelease;
export declare function prepareBinaryAcpRelease(input: BinaryAcpRelease, options: ArtifactOptions & {
    root: string;
}): Promise<import("./shared.js").Launch & {
    release: BinaryAcpRelease;
}>;
//# sourceMappingURL=binary.d.ts.map