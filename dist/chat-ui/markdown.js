"use client";
import { jsx as _jsx } from "react/jsx-runtime";
import { Streamdown } from "streamdown";
import { createElement, } from "react";
import { chatClassNames } from "./utils.js";
/**
 * Backchat's one block rhythm for both streaming-markdown and settled
 * Streamdown output. The semantic class is also styled by styles.css so a
 * host does not have to rely on Tailwind discovering this package's sources.
 */
export const CHAT_MARKDOWN_BLOCK_RHYTHM = chatClassNames("chat-markdown", "[&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-[16px] [&_h1]:font-semibold [&_h1]:leading-7", "[&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:leading-7", "[&_h3]:mt-2.5 [&_h3]:mb-1 [&_h3]:text-[14px] [&_h3]:font-semibold [&_h3]:leading-7", "[&_h4]:mt-2 [&_h4]:mb-1 [&_h4]:text-[14px] [&_h4]:font-semibold [&_h4]:leading-7", "[&_p]:my-1.5", "[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5", "[&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5", "[&_li]:my-0.5 [&_li]:py-0 [&_li>p]:my-0", "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border/60 [&_pre]:bg-bg-surface/60 [&_pre]:px-3 [&_pre]:py-2 [&_pre]:font-mono [&_pre]:text-[13px] [&_pre]:leading-6", "[&_code]:rounded [&_code]:bg-bg-surface/70 [&_code]:px-[0.35em] [&_code]:py-[0.1em] [&_code]:font-mono [&_code]:text-[0.9em]", "[&_pre_code]:bg-transparent [&_pre_code]:px-0 [&_pre_code]:py-0 [&_pre_code]:text-[13px]", "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-fg-muted", "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse", "[&_th]:border [&_th]:border-border/60 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-[13px] [&_th]:font-semibold [&_th]:leading-6", "[&_td]:border [&_td]:border-border/60 [&_td]:px-2 [&_td]:py-1 [&_td]:text-[13px] [&_td]:leading-6", "[&_hr]:my-3 [&_hr]:border-border/60", "[&_a]:text-fg [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-fg-muted", "[&_strong]:font-semibold [&_em]:italic", "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0");
export const CHAT_MARKDOWN_PROSE_CLASS = "font-chat text-[14px] leading-7 text-fg";
export const CHAT_ASSISTANT_MARKDOWN_CLASS = chatClassNames(CHAT_MARKDOWN_PROSE_CLASS, CHAT_MARKDOWN_BLOCK_RHYTHM);
export const CHAT_THOUGHT_MARKDOWN_CLASS = chatClassNames("chat-markdown--thought font-chat text-[13px] leading-6 text-fg-muted", CHAT_MARKDOWN_BLOCK_RHYTHM);
const baseComponents = {
    table: ({ className: _className, children, ...rest }) => (_jsx("table", { ...rest, className: "my-2 w-full border-collapse", children: children })),
    pre: ({ className: _className, children, ...rest }) => (_jsx("pre", { ...rest, className: "my-2 overflow-x-auto rounded-lg border border-border/60 bg-bg-surface/60 px-3 py-2 font-mono text-[12px] leading-5", children: children })),
    code: ({ className, children, ...rest }) => className?.startsWith("language-") ? (_jsx("code", { ...rest, className: className, children: children })) : (_jsx("code", { ...rest, className: "rounded bg-bg-surface/70 px-[0.35em] py-[0.1em] font-mono text-[0.9em] text-fg", children: children })),
};
/** The settled half of Backchat's dual-track Markdown renderer. */
export function ChatMarkdown({ text, className = CHAT_ASSISTANT_MARKDOWN_CLASS, controls = { code: false, table: false, mermaid: false }, linkSafety = false, components, }) {
    const Component = Streamdown;
    return createElement(Component, {
        className,
        children: text,
        controls,
        linkSafety,
        components: { ...baseComponents, ...components },
        "data-chat-markdown": "settled",
    });
}
//# sourceMappingURL=markdown.js.map