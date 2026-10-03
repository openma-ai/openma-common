/**
 * Static overlay over the official ACP registry.
 *
 * The official registry at
 * https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json is the
 * source of truth for ACP-compatible agents (~35 entries, auto-updated). This
 * file holds only the deltas the desktop needs on top:
 *
 *   1. Featured-agent ordering (the four we promote in the agent picker).
 *   2. Agents not in the official registry yet (hermes, openclaw).
 *
 * Browser-safe (no node deps): the renderer can import this directly when it
 * just needs an entry's display label / install hint without rewinding through
 * IPC. The main process additionally fetches the full official registry at
 * runtime (registry-fetch.ts) and merges.
 */
export function registryShimName(id) {
    return `openma-acp-${id}`;
}
export const OVERLAY_AGENTS = [
    {
        id: "claude-acp",
        label: "Claude",
        spec: { command: "claude-agent-acp" },
        featured: true,
        wraps: "claude",
        registryId: "claude-acp",
        installSource: "registry",
        install: { kind: "npm", package: "@agentclientprotocol/claude-agent-acp" },
        installHint: "npm install -g @agentclientprotocol/claude-agent-acp",
        homepage: "https://github.com/agentclientprotocol/claude-agent-acp",
    },
    {
        id: "codex-acp",
        label: "Codex",
        spec: { command: "codex-acp" },
        featured: true,
        wraps: "codex",
        registryId: "codex-acp",
        installSource: "registry",
        installHint: "download from https://github.com/zed-industries/codex-acp/releases and place on PATH",
        homepage: "https://github.com/zed-industries/codex-acp",
    },
    {
        // Keep the existing harness id while using OpenMA's Pi adapter. The public
        // registry points at a different package; npm supplies this package's latest.
        id: "pi-acp",
        label: "Pi",
        spec: { command: registryShimName("pi-acp") },
        registryId: "pi-acp",
        installSource: "registry",
        install: { kind: "npm", package: "@openma/pi-acp" },
        registryDistribution: { npx: { package: "@openma/pi-acp" } },
        installHint: "npm install -g @openma/pi-acp@latest",
        homepage: "https://github.com/openma-ai/pi-acp",
    },
    {
        id: "gemini",
        label: "Gemini CLI",
        spec: { command: registryShimName("gemini"), args: ["--acp"] },
        registryId: "gemini",
        installSource: "registry",
        installHint: "npm install -g @google/gemini-cli",
        homepage: "https://github.com/google-gemini/gemini-cli",
    },
    {
        id: "opencode",
        label: "OpenCode",
        spec: { command: registryShimName("opencode"), args: ["acp"] },
        registryId: "opencode",
        installSource: "registry",
        installHint: "npm install -g opencode-ai@latest  # or curl -fsSL https://opencode.ai/install | bash",
        homepage: "https://opencode.ai/",
    },
    {
        id: "cursor",
        label: "Cursor",
        spec: { command: registryShimName("cursor"), args: ["acp"] },
        systemPath: true,
        systemCommand: "cursor-agent",
        registryId: "cursor",
        installSource: "registry",
        installHint: "Install the Cursor CLI so `cursor-agent` is on PATH (https://cursor.com/docs/cli/acp)",
        homepage: "https://cursor.com/docs/cli/acp",
    },
    {
        id: "qwen-code",
        label: "Qwen Code",
        spec: { command: registryShimName("qwen-code"), args: ["--acp", "--experimental-skills"] },
        registryId: "qwen-code",
        installSource: "registry",
        homepage: "https://github.com/QwenLM/qwen-code",
    },
    {
        id: "github-copilot-cli",
        label: "GitHub Copilot",
        spec: { command: registryShimName("github-copilot-cli"), args: ["--acp"] },
        registryId: "github-copilot-cli",
        installSource: "registry",
        homepage: "https://github.com/github/copilot-cli",
    },
    {
        id: "kilo",
        label: "Kilo",
        spec: { command: registryShimName("kilo"), args: ["acp"] },
        registryId: "kilo",
        installSource: "registry",
        homepage: "https://kilo.ai/",
    },
    {
        // The public ACP registry still points `kimi` at the retired Python/Rust
        // Kimi CLI line. Backchat intentionally tracks the replacement Kimi Code
        // package, whose ACP entrypoint is `kimi acp`.
        id: "kimi",
        label: "Kimi Code",
        spec: { command: registryShimName("kimi"), args: ["acp"] },
        version: "0.33.0",
        registryId: "kimi",
        installSource: "registry",
        install: { kind: "npm", package: "@moonshot-ai/kimi-code" },
        registryDistribution: {
            npx: { package: "@moonshot-ai/kimi-code@0.33.0", args: ["acp"] },
        },
        installHint: "npm install -g @moonshot-ai/kimi-code@latest",
        homepage: "https://github.com/MoonshotAI/kimi-code",
    },
    {
        id: "grok-build",
        label: "Grok Build",
        spec: { command: registryShimName("grok-build"), args: ["agent", "stdio"] },
        registryId: "grok-build",
        installSource: "registry",
        homepage: "https://github.com/xai-org/grok-cli",
    },
    {
        id: "amp-acp",
        label: "Amp",
        spec: { command: registryShimName("amp-acp") },
        registryId: "amp-acp",
        installSource: "registry",
        homepage: "https://github.com/tao12345666333/amp-acp",
    },
    {
        id: "goose",
        label: "Goose",
        spec: { command: registryShimName("goose"), args: ["acp"] },
        registryId: "goose",
        installSource: "registry",
        homepage: "https://block.github.io/goose/",
    },
    {
        id: "cline",
        label: "Cline",
        spec: { command: registryShimName("cline"), args: ["--acp"] },
        registryId: "cline",
        installSource: "registry",
        homepage: "https://cline.bot/",
    },
    {
        id: "auggie",
        label: "Auggie CLI",
        spec: { command: registryShimName("auggie"), args: ["--acp"] },
        registryId: "auggie",
        installSource: "registry",
        homepage: "https://www.augmentcode.com/",
    },
    {
        id: "hermes",
        label: "Hermes",
        spec: { command: "hermes", args: ["acp"] },
        featured: true,
        systemPath: true,
        installHint: "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash",
        homepage: "https://github.com/NousResearch/hermes-agent",
    },
    {
        id: "openclaw",
        label: "OpenClaw",
        spec: { command: "openclaw", args: ["acp"] },
        featured: true,
        systemPath: true,
        installHint: "npm install -g openclaw",
        homepage: "https://github.com/openclaw/openclaw",
    },
    {
        id: "dsh-acp",
        label: "DeepSeek Harness",
        spec: { command: "dsh-acp" },
        featured: true,
        // Registry-protocol agent (npx distribution): app-managed install into
        // the managed ACP bin dir. Official entry pending
        // (agentclientprotocol/registry#506); until it lands, the embedded npx
        // distribution below covers installation and the merge layer then picks
        // up icon/version/distribution automatically.
        registryId: "dsh-acp",
        installSource: "registry",
        install: { kind: "npm", package: "@openma/deepseek-harness-acp" },
        registryDistribution: {
            npx: { package: "@openma/deepseek-harness-acp" },
        },
        installHint: "npm install -g @openma/deepseek-harness-acp",
        homepage: "https://github.com/openma-ai/deepseek-harness-acp",
    },
];
export function resolveOverlayAgent(id) {
    for (const e of OVERLAY_AGENTS)
        if (e.id === id)
            return e;
    return null;
}
//# sourceMappingURL=known-agents.js.map