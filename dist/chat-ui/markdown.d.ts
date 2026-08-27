import { type ComponentType } from "react";
/**
 * Backchat's one block rhythm for both streaming-markdown and settled
 * Streamdown output. The semantic class is also styled by styles.css so a
 * host does not have to rely on Tailwind discovering this package's sources.
 */
export declare const CHAT_MARKDOWN_BLOCK_RHYTHM: string;
export declare const CHAT_MARKDOWN_PROSE_CLASS = "font-chat text-[14px] leading-7 text-fg";
export declare const CHAT_ASSISTANT_MARKDOWN_CLASS: string;
export declare const CHAT_THOUGHT_MARKDOWN_CLASS: string;
export interface ChatMarkdownProps {
    text: string;
    className?: string;
    controls?: {
        code?: boolean;
        table?: boolean;
        mermaid?: boolean;
    };
    linkSafety?: boolean;
    /** Product behavior such as link activation is injected by the host. */
    components?: Record<string, ComponentType<any>>;
}
/** The settled half of Backchat's dual-track Markdown renderer. */
export declare function ChatMarkdown({ text, className, controls, linkSafety, components, }: ChatMarkdownProps): import("react").ReactElement<{
    children: string;
    className?: string;
    controls?: {
        code?: boolean;
        table?: boolean;
        mermaid?: boolean;
    };
    linkSafety?: boolean;
    components?: Record<string, ComponentType<any>>;
}, string | import("react").JSXElementConstructor<any>>;
//# sourceMappingURL=markdown.d.ts.map