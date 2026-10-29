import { type ComponentType } from "react";
/**
 * DeepSeek Harness collaboration / agent-preset glyphs.
 *
 * Official dsh web (`IconAgentPresetOutline16`) uses the 3-node graph on the
 * preset chip for Standard. Distinct option marks come from the same ic_ds_*
 * set. Source: deepseek-ai/deepseek-harness ui-primitives icons (via Backchat).
 */
export type DshPresetIcon = ComponentType<{
    className?: string;
}>;
export declare function DshPresetStandardIcon({ className }: {
    className?: string;
}): import("react").JSX.Element;
/** Official `IconCodeOutline16` — octothorpe. */
export declare function DshPresetCodeIcon({ className }: {
    className?: string;
}): import("react").JSX.Element;
export declare function DshPresetMinimalIcon({ className }: {
    className?: string;
}): import("react").JSX.Element;
/** Official `IconCordisPluginOutline14`. */
export declare function DshPresetCordisIcon({ className }: {
    className?: string;
}): import("react").JSX.Element;
export declare function agentPresetIcon(value: string): DshPresetIcon;
//# sourceMappingURL=dsh-preset-icons.d.ts.map