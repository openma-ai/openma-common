import { describe, expect, it } from "vitest";
import {
  decodeSessionCommand,
  encodeSessionHostEvent,
  initialSessionLifecycle,
  reduceSessionLifecycle,
} from "../src/session-kernel/index.js";

describe("canonical session lifecycle", () => {
  it("drives the same start, prompt, complete, error and dispose states for every host", () => {
    let state = initialSessionLifecycle("session-1");
    state = reduceSessionLifecycle(state, { type: "start.requested" });
    expect(state.status).toBe("starting");

    state = reduceSessionLifecycle(state, {
      type: "session.ready",
      acpSessionId: "acp-1",
    });
    expect(state).toMatchObject({ status: "ready", acpSessionId: "acp-1" });

    state = reduceSessionLifecycle(state, {
      type: "prompt.requested",
      turnId: "turn-1",
    });
    expect(state).toMatchObject({ status: "running", activeTurnId: "turn-1" });

    state = reduceSessionLifecycle(state, {
      type: "session.complete",
      turnId: "turn-1",
    });
    expect(state).toMatchObject({ status: "ready", activeTurnId: undefined });

    state = reduceSessionLifecycle(state, {
      type: "session.error",
      turnId: "turn-2",
      message: "boom",
    });
    expect(state).toMatchObject({ status: "errored", lastError: "boom" });

    state = reduceSessionLifecycle(state, { type: "session.disposed" });
    expect(state.status).toBe("disposed");
  });

  it("ignores stale completion from an older turn", () => {
    let state = initialSessionLifecycle("session-1");
    state = reduceSessionLifecycle(state, { type: "start.requested" });
    state = reduceSessionLifecycle(state, {
      type: "session.ready",
      acpSessionId: "acp-1",
    });
    state = reduceSessionLifecycle(state, {
      type: "prompt.requested",
      turnId: "turn-new",
    });

    expect(reduceSessionLifecycle(state, {
      type: "session.complete",
      turnId: "turn-old",
    })).toEqual(state);
  });

  it("returns to ready when the active turn is cancelled", () => {
    let state = initialSessionLifecycle("session-1");
    state = reduceSessionLifecycle(state, { type: "start.requested" });
    state = reduceSessionLifecycle(state, { type: "session.ready", acpSessionId: "acp-1" });
    state = reduceSessionLifecycle(state, { type: "prompt.requested", turnId: "turn-1" });
    expect(reduceSessionLifecycle(state, { type: "prompt.cancelled", turnId: "turn-1" })).toMatchObject({
      status: "ready",
      activeTurnId: undefined,
    });
  });

  it("converts the snake_case relay wire format into the same host contract", () => {
    expect(decodeSessionCommand({
      type: "session.start",
      session_id: "sid",
      agent_id: "claude-acp",
      tenant_id: "tenant",
      resume: { acp_session_id: "acp-old" },
    })).toEqual({
      type: "session.start",
      sessionId: "sid",
      agentId: "claude-acp",
      runtime: "local",
      acpSessionId: "acp-old",
    });

    expect(encodeSessionHostEvent({
      type: "session.complete",
      sessionId: "sid",
      turnId: "turn",
    }, { tenantId: "tenant" })).toEqual({
      type: "session.complete",
      session_id: "sid",
      tenant_id: "tenant",
      turn_id: "turn",
    });
  });
});
