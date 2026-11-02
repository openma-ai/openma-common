import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ToolConfirmationAsk,
  pendingManagedActions,
} from "../src/chat-ui/index.js";

describe("ToolConfirmationAsk", () => {
  it("renders Allow/Deny for confirmation actions and skips custom_result", () => {
    const actions = pendingManagedActions([
      {
        type: "agent.tool_use",
        id: "tool",
        name: "bash",
        input: { command: "printf OK" },
        evaluated_permission: "ask",
      },
      {
        type: "agent.custom_tool_use",
        id: "question",
        name: "Question",
        input: { question: "branch?" },
      },
      {
        type: "session.status_idle",
        stop_reason: {
          type: "requires_action",
          event_ids: ["tool", "question"],
        },
      },
    ]);

    const onSubmit = vi.fn();
    const html = renderToStaticMarkup(
      <ToolConfirmationAsk actions={actions} onSubmit={onSubmit} />,
    );

    expect(html).toContain('data-tool-confirmation="true"');
    expect(html).toContain('data-tool-confirmation-id="tool"');
    expect(html).toContain('data-tool-confirmation-allow="true"');
    expect(html).toContain('data-tool-confirmation-deny="true"');
    expect(html).toContain("Approval required");
    expect(html).toContain("bash");
    expect(html).toContain("printf OK");
    expect(html).not.toContain('data-tool-confirmation-id="question"');
  });

  it("returns null when there are no confirmation actions", () => {
    const html = renderToStaticMarkup(
      <ToolConfirmationAsk
        actions={[
          {
            id: "question",
            type: "custom_result",
            event: { type: "agent.custom_tool_use", id: "question", name: "Q" },
          },
        ]}
        onSubmit={vi.fn()}
      />,
    );
    expect(html).toBe("");
  });
});
