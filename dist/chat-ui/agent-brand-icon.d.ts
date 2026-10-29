type AgentBrandIconProps = {
    agentId?: string | null;
    className?: string;
    title?: string;
    /** Optional registry/custom mask URL when no built-in brand mark exists. */
    iconUrl?: string | null;
};
/**
 * Normalize host / registry agent ids onto the shared brand-mark keys.
 * `dsh` / `deepseek` → DeepSeek Harness whale mark (not a generic robot).
 */
export declare function normalizeAgentBrandId(agentId?: string | null): string;
/**
 * Shared harness / provider brand mark for composer model chips and pickers.
 * Hosts theme via `currentColor` + className; do not hard-code product colors.
 */
/** Accessible / display title for a known brand mark, else null. */
export declare function agentBrandDisplayTitle(agentId?: string | null): string | null;
export declare function AgentBrandIcon({ agentId, className, title, iconUrl, }: AgentBrandIconProps): import("react").JSX.Element;
export type { AgentBrandIconProps };
//# sourceMappingURL=agent-brand-icon.d.ts.map