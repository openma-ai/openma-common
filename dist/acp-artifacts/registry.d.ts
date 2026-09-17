import { type NpmAcpRelease } from "./npm.js";
import { type UvxAcpRelease, type UvxAcpReleaseInput } from "./uvx.js";
import { type BinaryAcpRelease } from "./binary.js";
import { type ArtifactOptions, type Launch } from "./shared.js";
type DistributionRelease = NpmAcpRelease | UvxAcpRelease | BinaryAcpRelease;
export interface RegistryAcpRelease {
    schema: "openma.acp.registry.v1";
    id: string;
    version: string;
    source: string;
    artifact: DistributionRelease;
    args: string[];
    env: Record<string, string>;
    digest: string;
}
export type AcpRelease = DistributionRelease | RegistryAcpRelease;
export type AcpReleaseSource = {
    type: "npm";
    package: string;
} | ({
    type: "uvx";
} & Omit<UvxAcpReleaseInput, "id" | "version">) | {
    type: "registry";
    manifestUrl?: string;
    preference?: ("binary" | "npx" | "uvx")[];
};
/** String entries are the backwards-compatible npm package catalog. */
export declare function parseAcpReleaseSource(value: unknown): AcpReleaseSource;
export declare function validateAcpRelease(value: unknown): AcpRelease;
export declare function acpReleaseMatchesSource(release: AcpRelease, input: AcpReleaseSource): boolean;
export declare function resolveAcpRelease(selection: {
    id: string;
    version: string;
}, input?: AcpReleaseSource, options?: ArtifactOptions): Promise<AcpRelease>;
export declare function prepareAcpRelease(input: AcpRelease, options: ArtifactOptions & {
    root: string;
}): Promise<Launch & {
    release: AcpRelease;
}>;
export {};
//# sourceMappingURL=registry.d.ts.map