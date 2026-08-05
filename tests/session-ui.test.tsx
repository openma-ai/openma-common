import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionTurnFrame } from "../src/session-ui/index.js";

describe("SessionTurnFrame", () => {
  it("renders the shared prompt and response shell", () => {
    const html = renderToStaticMarkup(
      <SessionTurnFrame
        turnId="turn-1"
        sessionId="session-1"
        promptText="Inspect this repository"
        status="running"
      >
        <p>Working</p>
      </SessionTurnFrame>,
    );

    expect(html).toContain('data-turn-id="turn-1"');
    expect(html).toContain('data-source-session-id="session-1"');
    expect(html).toContain('data-annotation-ready="false"');
    expect(html).toContain('data-session-turn-prompt="true"');
    expect(html).toContain("Inspect this repository");
    expect(html).toContain("Working");
  });

  it("owns the canonical error and cancellation status treatment", () => {
    const error = renderToStaticMarkup(
      <SessionTurnFrame
        turnId="turn-error"
        status="error"
        errorMessage="Permission denied"
      />,
    );
    const cancelled = renderToStaticMarkup(
      <SessionTurnFrame turnId="turn-cancelled" status="cancelled" />,
    );

    expect(error).toContain('role="alert"');
    expect(error).toContain("Permission denied");
    expect(error).toContain('data-annotation-ready="true"');
    expect(cancelled).toContain("cancelled");
  });

  it("shows an explicit non-streaming state when terminal evidence is missing", () => {
    const unknown = renderToStaticMarkup(
      <SessionTurnFrame turnId="turn-unknown" status="unknown" />,
    );

    expect(unknown).toContain('data-session-turn-status="unknown"');
    expect(unknown).toContain('data-annotation-ready="true"');
    expect(unknown).toContain("terminal status unavailable");
  });
});
