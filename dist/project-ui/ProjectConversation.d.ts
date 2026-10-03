import type { ReactNode } from "react";
import type { ProjectChatTurn } from "./project-goals.js";
/** Project delivery stays on the host client. The visible column is the shared chat shell. */
export declare function ProjectConversation({ turns, composer, promptPayloads, cwd, }: {
    turns: readonly ProjectChatTurn[];
    composer: ReactNode;
    promptPayloads?: ReadonlyMap<string, unknown>;
    cwd?: string | null;
}): import("react").JSX.Element;
//# sourceMappingURL=ProjectConversation.d.ts.map