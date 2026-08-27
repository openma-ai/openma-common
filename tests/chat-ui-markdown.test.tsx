import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CHAT_ASSISTANT_MARKDOWN_CLASS,
  ChatMarkdown,
} from "../src/chat-ui/markdown.js";

describe("Backchat settled Markdown surface", () => {
  it("renders Markdown syntax instead of exposing it as plain text", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown
        text={"**Preparing response**\n\n- first\n- second"}
        className={CHAT_ASSISTANT_MARKDOWN_CLASS}
      />,
    );

    expect(html).toContain('data-streamdown="strong"');
    expect(html).toContain(">Preparing response</span>");
    expect(html).toContain("<ul");
    expect(html).not.toContain("**Preparing response**");
  });

  it("uses the same geometry contract for settled and streaming Markdown", () => {
    expect(CHAT_ASSISTANT_MARKDOWN_CLASS).toContain("chat-markdown");
    expect(CHAT_ASSISTANT_MARKDOWN_CLASS).toContain("font-chat");
    expect(CHAT_ASSISTANT_MARKDOWN_CLASS).toContain("text-[14px]");
    expect(CHAT_ASSISTANT_MARKDOWN_CLASS).toContain("leading-7");
  });
});
