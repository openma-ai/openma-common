/** Install-time source for a catalog harness. Only `type` differs between entries. */
export type AcpHarnessInstallSource = {
    type: "npm";
    package: string;
} | {
    type: "uvx";
    package: string;
    command?: string;
    python?: string;
    indexUrl?: string;
    args?: string[];
    env?: Record<string, string>;
} | {
    type: "registry";
    manifestUrl?: string;
    preference?: ("binary" | "npx" | "uvx")[];
} | {
    type: "binary";
    platform: string;
    archive: string;
    sha256: string;
    format?: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
};
//# sourceMappingURL=source.d.ts.map