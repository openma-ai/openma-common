import { describe, expect, it } from "vitest";
import {
  decodeSessionCommand,
  decodeSessionHostEvent,
  encodeSessionCommand,
  encodeSessionHostEvent,
} from "../src/session-kernel/index.js";

describe("session relay boundary codec", () => {
  it("round-trips a start command without dropping cwd or resume", () => {
    const wire = {
      type: "session.start",
      session_id: "session_01",
      tenant_id: "workspace_01",
      agent_id: "agent_01",
      cwd: "/workspace",
      resume: { acp_session_id: "acp_01" },
    };
    const command = decodeSessionCommand(wire);

    expect(command).toEqual({
      type: "session.start",
      sessionId: "session_01",
      agentId: "agent_01",
      runtime: "local",
      cwd: "/workspace",
      acpSessionId: "acp_01",
    });
    expect(command && encodeSessionCommand(command, {
      tenantId: "workspace_01",
    })).toEqual(wire);
  });

  it("decodes every host event and keeps tenant data at the wire edge", () => {
    const wire = {
      type: "session.ready",
      session_id: "session_01",
      tenant_id: "workspace_01",
      acp_session_id: "acp_01",
    };
    const event = decodeSessionHostEvent(wire);

    expect(event).toEqual({
      type: "session.ready",
      sessionId: "session_01",
      acpSessionId: "acp_01",
    });
    expect(event && encodeSessionHostEvent(event, {
      tenantId: "workspace_01",
    })).toEqual(wire);

    expect(decodeSessionHostEvent({
      type: "session.event",
      session_id: "session_01",
      turn_id: "turn_01",
      event: { type: "agent.message" },
    })).toEqual({
      type: "session.event",
      sessionId: "session_01",
      turnId: "turn_01",
      event: { type: "agent.message" },
    });
    expect(decodeSessionHostEvent({
      type: "session.complete",
      session_id: "session_01",
      turn_id: "turn_01",
    })).toEqual({
      type: "session.complete",
      sessionId: "session_01",
      turnId: "turn_01",
    });
    expect(decodeSessionHostEvent({
      type: "session.error",
      session_id: "session_01",
      message: "failed",
    })).toEqual({
      type: "session.error",
      sessionId: "session_01",
      message: "failed",
    });
    expect(decodeSessionHostEvent({
      type: "session.disposed",
      session_id: "session_01",
    })).toEqual({
      type: "session.disposed",
      sessionId: "session_01",
    });
  });

  it("rejects malformed relay messages", () => {
    expect(decodeSessionHostEvent({ type: "session.ready" })).toBeNull();
    expect(decodeSessionHostEvent({
      type: "session.complete",
      session_id: "session_01",
    })).toBeNull();
    expect(decodeSessionCommand({
      type: "session.start",
      session_id: "session_01",
    })).toBeNull();
  });
});
