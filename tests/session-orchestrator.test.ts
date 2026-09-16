import { describe, expect, it } from "vitest";
import {
  SessionOrchestrator,
  sessionInheritance,
} from "../src/session-orchestrator/index.js";

describe("shared session orchestrator", () => {
  it("serializes prompts without letting a later prompt jump the queue", () => {
    const session = new SessionOrchestrator<string>({
      sessionId: "session-1",
      now: () => 10,
    });

    expect(session.tryStartTurn("turn-1")).toBe(true);
    session.enqueue("turn-2", "second");
    session.enqueue("turn-3", "third");
    expect(session.tryStartTurn("turn-4")).toBe(false);

    session.finishTurn("turn-1");
    expect(session.claimNext()).toEqual({
      turnId: "turn-2",
      value: "second",
      createdAt: 10,
    });
    expect(session.activeTurnId).toBe("turn-2");
    expect(session.queued.map((entry) => entry.turnId)).toEqual(["turn-3"]);
  });

  it("updates an existing queued turn without duplicating its completion slot", () => {
    let clock = 20;
    const session = new SessionOrchestrator<string>({
      sessionId: "session-1",
      now: () => clock++,
    });

    const original = session.enqueue("turn-1", "draft");
    const replaced = session.enqueue("turn-1", "edited");

    expect(replaced).toBe(original);
    expect(session.queued).toEqual([
      { turnId: "turn-1", value: "edited", createdAt: 20 },
    ]);
  });

  it("reorders named turns first and preserves FIFO order for unspecified turns", () => {
    let clock = 1;
    const session = new SessionOrchestrator<string>({
      sessionId: "session-1",
      now: () => clock++,
    });
    session.enqueue("turn-a", "a");
    session.enqueue("turn-b", "b");
    session.enqueue("turn-c", "c");

    session.reorderQueue(["turn-c"]);

    expect(session.queued.map((entry) => entry.turnId)).toEqual([
      "turn-c",
      "turn-a",
      "turn-b",
    ]);
  });

  it("does not drain while steering is unresolved", () => {
    const session = new SessionOrchestrator<string>({ sessionId: "session-1" });
    expect(session.tryStartTurn("turn-active")).toBe(true);
    expect(session.beginSteering("turn-steer")).toBe(true);
    session.enqueue("turn-next", "next");
    session.finishTurn("turn-active");

    expect(session.claimNext()).toBeNull();
    session.finishSteering("turn-steer");
    expect(session.claimNext()?.turnId).toBe("turn-next");
  });

  it("holds the queue for an after-turn restart and releases it when restart clears", () => {
    const session = new SessionOrchestrator<string>({ sessionId: "session-1" });
    expect(session.tryStartTurn("turn-active")).toBe(true);
    session.enqueue("turn-next", "next");

    expect(session.requestRestart("after-turn")).toBe("pending");
    session.finishTurn("turn-active");
    expect(session.claimNext()).toBeNull();

    session.clearRestart();
    expect(session.claimNext()?.turnId).toBe("turn-next");
  });

  it("returns every abandoned queue entry exactly once on dispose", () => {
    const session = new SessionOrchestrator<string>({ sessionId: "session-1" });
    session.enqueue("turn-1", "one");
    session.enqueue("turn-2", "two");

    expect(session.dispose().map((entry) => entry.turnId)).toEqual([
      "turn-1",
      "turn-2",
    ]);
    expect(session.dispose()).toEqual([]);
    expect(session.queued).toEqual([]);
    expect(session.tryStartTurn("turn-3")).toBe(false);
  });

  it("models fork as session inheritance while preserving the same workspace", () => {
    expect(sessionInheritance({
      cwd: "/vault",
      additionalDirectories: ["/shared"],
      forkFrom: {
        sessionId: "parent-host-session",
        acpSessionId: "parent-acp-session",
      },
    })).toEqual({
      kind: "fork",
      cwd: "/vault",
      additionalDirectories: ["/shared"],
      parentSessionId: "parent-host-session",
      forkFromAcpSessionId: "parent-acp-session",
    });
  });

  it("rejects ambiguous resume and fork inheritance", () => {
    expect(() => sessionInheritance({
      cwd: "/vault",
      resumeAcpSessionId: "resume-session",
      forkFrom: {
        acpSessionId: "fork-session",
      },
    })).toThrow("cannot resume and fork the same session");
  });
});
