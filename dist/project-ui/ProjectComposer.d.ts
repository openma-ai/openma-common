import type { ProjectAttachment } from "./client.js";
/** Presentational composer. Delivery stays with the host's `ProjectClient.submit`. */
export declare function ProjectComposer({ agentId, agentLabel, placeholder, busy, onSubmit, onEditAgents, role, label, }: {
    agentId: string;
    agentLabel?: string;
    role?: string;
    label?: string;
    placeholder: string;
    busy: boolean;
    onSubmit: (text: string, attachments: ProjectAttachment[]) => Promise<boolean>;
    onEditAgents: () => void;
}): import("react").JSX.Element;
//# sourceMappingURL=ProjectComposer.d.ts.map