import { forkSupport, type AcpRuntime, type SessionOptions } from "../src/acp-runtime/index.js";
import { describe, expect, it, vi } from "vitest";

import {
  createManagedAcpSupervisorHarness,
  ManagedAcpEventProjector,
  type ManagedHarnessControlChannel,
  type ManagedHarnessControlMessage,
  type ManagedHarnessPublishedEvent,
  type ManagedHarnessSessionStatePort,
} from "../src/managed-runtime/index.js";

const scope = {
  workspaceId: "workspace_1",
  environmentId: "environment_1",
  sessionId: "session_1",
  workId: "work_1",
};

function commandChannel(commands: readonly ManagedHarnessControlMessage[], log: string[]) {
  const published: ManagedHarnessPublishedEvent[] = [];
  const channel: ManagedHarnessControlChannel = {
    async *commands() {
      for (const command of commands) yield command;
      yield { type: "control.complete", workId: scope.workId };
    },
    async publish(event) {
      const diagnostic = event as unknown as {
        type: string;
        source?: string;
        details?: { reason?: string };
      };
      log.push([
        "publish",
        diagnostic.type,
        diagnostic.source,
        diagnostic.details?.reason,
      ].filter((part) => part !== undefined).join(":"));
      published.push(event);
    },
    close: vi.fn(async () => { log.push("control:close"); }),
  };
  return { channel, published };
}

function abruptlyClosedChannel(
  commands: readonly ManagedHarnessControlMessage[],
  log: string[],
): ManagedHarnessControlChannel {
  return {
    async *commands() {
      for (const command of commands) yield command;
    },
    async publish(event) { log.push(`publish:${event.type}`); },
    async close() { log.push("control:close"); },
  };
}

function fakeAcpRuntime(log: string[], hooks: {
  promptGate?: Promise<void>;
  promptError?: Error;
  onPromptStarted?(text: string): void;
  promptGateFor?(text: string): Promise<void>;
  onCancel?(): void;
  onSteer?(text: string): void;
} = {}): AcpRuntime {
  return {
    async start(sessionOptions: SessionOptions) {
      log.push(`acp:start:${sessionOptions.resumeAcpSessionId ?? "new"}`);
      return {
        id: "internal_1",
        acpSessionId: "acp_1",
        options: sessionOptions,
        authMethods: [],
        protocolVersion: null,
        agentInfo: null,
        agentCapabilities: {},
        initializeMeta: null,
        sessionSetupMeta: null,
        configOptions: [],
        legacyModels: null,
        modes: null,
        promptCapabilities: {},
        supportsSessionFork: false,
        forkSupport: forkSupport({ agentCapabilities: {}, agentInfo: null }),
        supportsSessionList: false,
        supportsSessionDelete: false,
        supportsSessionResume: true,
        supportsSessionClose: true,
        supportsAdditionalDirectories: false,
        supportsLogout: false,
        supportsProviders: false,
        supportsNes: false,
        nesCapabilities: null,
        positionEncoding: null,
        // Every ACP harness admitted by OpenMA supports steering. Tests that
        // do not care about a steer still model a conforming agent.
        supportsSteering: true,
        async *prompt(text: string | readonly unknown[], options?: { abortSignal?: AbortSignal; onDispatched?(): Promise<void> }) {
          options?.abortSignal?.addEventListener("abort", () => hooks.onCancel?.(), { once: true });
          log.push(`acp:prompt:${String(text)}`);
          await options?.onDispatched?.();
          hooks.onPromptStarted?.(String(text));
          await hooks.promptGate;
          await hooks.promptGateFor?.(String(text));
          if (hooks.promptError !== undefined) throw hooks.promptError;
          yield { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } };
          yield {
            type: "promptComplete",
            response: { usage: { inputTokens: 10, outputTokens: 2, cachedReadTokens: 8 } },
          };
        },
        async steer(text: string | readonly unknown[]) {
          hooks.onSteer?.(String(text));
          log.push(`acp:steer:${String(text)}`);
          return "injected" as const;
        },
        async cancelCurrentTurn() {},
        drainPendingEvents() { return []; },
        async setConfigOption() { return []; },
        async authenticate() {},
        async setMode() {},
        async listSessions() { return { sessions: [] }; },
        async deleteSession() {},
        async logout() {},
        async listProviders() { return { providers: [] }; },
        async setProvider() {},
        async disableProvider() {},
        async requestExtension() { return {}; },
        async notifyExtension() {},
        async startNes() { return {}; },
        async suggestNes() { return {}; },
        async closeNes() {},
        async didOpenDocument() {},
        async didChangeDocument() {},
        async didCloseDocument() {},
        async didSaveDocument() {},
        async didFocusDocument() {},
        async acceptNes() {},
        async rejectNes() {},
        isAlive() { return true; },
        async dispose() { log.push("acp:dispose"); },
      } as never;
    },
  };
}

describe("managed ACP harness in sandbox", () => {
  it("runs the Session command loop inside the supervisor and checkpoints before completion publication", async () => {
    const log: string[] = [];
    const { channel, published } = commandChannel([
      {
        type: "session.start",
        sessionId: scope.sessionId,
        agentId: "codex-acp",
        runtime: "cloud",
        acpSessionId: "old_acp",
      },
      {
        type: "session.prompt",
        sessionId: scope.sessionId,
        turnId: "turn_1",
        text: "ship it",
      },
    ], log);
    const state: ManagedHarnessSessionStatePort = {
      async beforeStart(command) {
        log.push("state:restore");
        return { command };
      },
      async onReady() { log.push("state:ready"); },
      async checkpoint() { log.push("state:checkpoint"); },
      async release(input) { log.push(`state:release:${input.reason}`); },
    };
    const harness = createManagedAcpSupervisorHarness({
      connect: async (input) => {
        expect(input).toMatchObject({
          scope,
          harness: { id: "acp", version: "1" },
          workspacePath: "/workspace",
          outputPath: "/mnt/session/outputs",
        });
        return channel;
      },
      acpRuntime: fakeAcpRuntime(log),
      sessionPreparation: {
        async prepare(command) {
          return {
            agent: { command: command.agentId },
            ...(command.acpSessionId ? { resumeAcpSessionId: command.acpSessionId } : {}),
          };
        },
      },
      sessionState: state,
      drainDeadlineMs: 100,
    });

    const run = await harness.start({
      scope,
      harness: { id: "acp", version: "1" },
      workspacePath: "/workspace",
      outputPath: "/mnt/session/outputs",
      checkpoint: async (checkpoint) => {
        log.push(`host:checkpoint:${checkpoint.turnId ?? "shutdown"}`);
      },
      signal: new AbortController().signal,
    });
    await expect(run.completed).resolves.toEqual({ exitCode: 0 });
    await run.drain();

    expect(log.indexOf("state:checkpoint")).toBeLessThan(
      log.indexOf("publish:session.complete"),
    );
    expect(log.indexOf("publish:session.complete")).toBeLessThan(
      log.indexOf("host:checkpoint:turn_1"),
    );
    expect(log).toContain("state:restore");
    expect(log).toContain("state:ready");
    expect(log).toContain("state:release:shutdown");
    expect(published.map((event) => event.type)).toEqual([
      "session.ready",
      "session.event",
      "session.event",
      "session.complete",
    ]);
  });

  it("keeps consuming control commands so steer reaches a still-running ACP turn", async () => {
    const log: string[] = [];
    let releasePrompt!: () => void;
    const promptGate = new Promise<void>((resolve) => {
      releasePrompt = resolve;
    });
    let announcePromptStarted!: () => void;
    const promptStarted = new Promise<void>((resolve) => {
      announcePromptStarted = resolve;
    });
    const steers: string[] = [];
    const { channel } = commandChannel([
      {
        type: "session.start",
        sessionId: scope.sessionId,
        agentId: "codex-acp",
        runtime: "cloud",
      },
      {
        type: "session.prompt",
        sessionId: scope.sessionId,
        turnId: "turn_1",
        text: "start",
      },
      {
        type: "session.steer",
        sessionId: scope.sessionId,
        eventId: "steer_1",
        text: "focus on cache behavior",
      },
    ], log);
    const harness = createManagedAcpSupervisorHarness({
      connect: async () => channel,
      acpRuntime: fakeAcpRuntime(log, {
        promptGate,
        onPromptStarted: announcePromptStarted,
        onSteer: (text) => steers.push(text),
      }),
      sessionPreparation: {
        async prepare(command) {
          return { agent: { command: command.agentId } };
        },
      },
      sessionState: {
        async beforeStart(command) { return { command }; },
        async onReady() {},
        async checkpoint() {},
        async release() {},
      },
      drainDeadlineMs: 100,
    });
    const run = await harness.start({
      scope,
      harness: { id: "acp", version: "1" },
      workspacePath: "/workspace",
      outputPath: null,
      checkpoint: async () => {},
      signal: new AbortController().signal,
    });
    await promptStarted;
    await new Promise<void>((resolve) => setImmediate(resolve));
    const steersBeforePromptRelease = [...steers];
    releasePrompt();
    await run.completed;
    await run.drain();

    expect(steersBeforePromptRelease).toEqual(["focus on cache behavior"]);
  });

  it.each([
    "native-state-missing",
    "native-state-stale",
  ] as const)("uses one semantic recovery prompt when native state is %s", async (reason) => {
    const log: string[] = [];
    const { channel } = commandChannel([
      {
        type: "session.start",
        sessionId: scope.sessionId,
        agentId: "codex-acp",
        runtime: "cloud",
        acpSessionId: "stale_acp",
      },
      {
        type: "session.prompt",
        sessionId: scope.sessionId,
        turnId: "turn_1",
        text: "continue",
      },
      {
        type: "session.prompt",
        sessionId: scope.sessionId,
        turnId: "turn_2",
        text: "next",
      },
    ], log);
    const harness = createManagedAcpSupervisorHarness({
      connect: async () => channel,
      acpRuntime: fakeAcpRuntime(log),
      sessionPreparation: {
        async prepare(command) {
          return { agent: { command: command.agentId } };
        },
      },
      sessionState: {
        async beforeStart(command) {
          return {
            command: { ...command, acpSessionId: undefined },
            semanticRecoveryReason: reason,
          };
        },
        async onReady() {},
        async checkpoint() {},
        async release() {},
      },
      semanticRecovery: {
        async build(input) {
          return `recovered:${input.currentPrompt}`;
        },
      },
      drainDeadlineMs: 100,
    });

    const run = await harness.start({
      scope,
      harness: { id: "acp", version: "1" },
      workspacePath: "/workspace",
      outputPath: null,
      checkpoint: async () => {},
      signal: new AbortController().signal,
    });
    await run.completed;

    expect(log).toContain("acp:start:new");
    expect(log).toContain("acp:prompt:recovered:continue");
    expect(log).toContain("acp:prompt:next");
    expect(log).toContain(
      `publish:session.warning:acp_semantic_recovery:${reason}`,
    );
    expect(log.indexOf(`publish:session.warning:acp_semantic_recovery:${reason}`))
      .toBeLessThan(log.indexOf("acp:prompt:recovered:continue"));
  });

  it("destroys native state on logical Session disposal", async () => {
    const log: string[] = [];
    const { channel } = commandChannel([
      {
        type: "session.start",
        sessionId: scope.sessionId,
        agentId: "pi-acp",
        runtime: "cloud",
      },
      { type: "session.dispose", sessionId: scope.sessionId },
    ], log);
    const harness = createManagedAcpSupervisorHarness({
      connect: async () => channel,
      acpRuntime: fakeAcpRuntime(log),
      sessionPreparation: { async prepare() { return { agent: { command: "pi-acp" } }; } },
      sessionState: {
        async beforeStart(command) { return { command }; },
        async onReady() {},
        async checkpoint() {},
        async release(input) { log.push(`state:release:${input.reason}`); },
      },
      drainDeadlineMs: 100,
    });

    const run = await harness.start({
      scope,
      harness: { id: "acp", version: "1" },
      workspacePath: "/workspace",
      outputPath: null,
      checkpoint: async () => {},
      signal: new AbortController().signal,
    });
    await run.completed;

    expect(log).toContain("state:release:destroy");
    expect(log).not.toContain("state:release:shutdown");
  });

  it("rejects cross-session commands before they reach ACP", async () => {
    const log: string[] = [];
    const { channel } = commandChannel([{
      type: "session.start",
      sessionId: "session_intruder",
      agentId: "codex-acp",
      runtime: "cloud",
    }], log);
    const harness = createManagedAcpSupervisorHarness({
      connect: async () => channel,
      acpRuntime: fakeAcpRuntime(log),
      sessionPreparation: { async prepare() { return { agent: { command: "codex-acp" } }; } },
      sessionState: inertState(),
    });

    const run = await startHarness(harness);
    await expect(run.completed).rejects.toThrow(
      "Harness control attempted cross-session command session_intruder",
    );
  });

  it("rejects a completion command claimed for another Work", async () => {
    const log: string[] = [];
    const channel = abruptlyClosedChannel([{
      type: "control.complete",
      workId: "work_intruder",
    }], log);
    const harness = createManagedAcpSupervisorHarness({
      connect: async () => channel,
      acpRuntime: fakeAcpRuntime(log),
      sessionPreparation: { async prepare() { return { agent: { command: "codex-acp" } }; } },
      sessionState: inertState(),
    });

    const run = await startHarness(harness);
    await expect(run.completed).rejects.toThrow(
      "Harness control attempted cross-work completion work_intruder",
    );
    await run.stop("failed");
  });

  it("fails closed when native state is missing without semantic recovery", async () => {
    const log: string[] = [];
    const { channel } = commandChannel([
      {
        type: "session.start",
        sessionId: scope.sessionId,
        agentId: "codex-acp",
        runtime: "cloud",
      },
      {
        type: "session.prompt",
        sessionId: scope.sessionId,
        turnId: "turn_missing",
        text: "continue",
      },
    ], log);
    const harness = createManagedAcpSupervisorHarness({
      connect: async () => channel,
      acpRuntime: fakeAcpRuntime(log),
      sessionPreparation: { async prepare() { return { agent: { command: "codex-acp" } }; } },
      sessionState: {
        ...inertState(),
        async beforeStart(command) {
          return { command, semanticRecoveryReason: "native-state-missing" };
        },
      },
    });

    const run = await startHarness(harness);
    await expect(run.completed).rejects.toThrow(
      "Native ACP state is unavailable and no semantic recovery Port is configured",
    );
  });

  it.each(["dispose", "complete"] as const)(
    "publishes an ACP prompt error and still settles control %s cleanly",
    async (boundary) => {
      const log: string[] = [];
      const commands: ManagedHarnessControlMessage[] = [
        {
          type: "session.start",
          sessionId: scope.sessionId,
          agentId: "codex-acp",
          runtime: "cloud",
        },
        {
          type: "session.prompt",
          sessionId: scope.sessionId,
          turnId: "turn_failed",
          text: "fail",
        },
      ];
      const channel = boundary === "dispose"
        ? commandChannel([
            ...commands,
            { type: "session.dispose", sessionId: scope.sessionId },
          ], log).channel
        : commandChannel(commands, log).channel;
      const harness = createManagedAcpSupervisorHarness({
        connect: async () => channel,
        acpRuntime: fakeAcpRuntime(log, { promptError: new Error("prompt failed") }),
        sessionPreparation: {
          async prepare() { return { agent: { command: "codex-acp" } }; },
        },
        sessionState: inertState(),
      });

      const run = await startHarness(harness);
      await expect(run.completed).resolves.toEqual({ exitCode: 0 });
      expect(log).toContain("publish:session.error");
      await run.drain();
    },
  );

  it("surfaces workspace CAS failure after canonical completion publication", async () => {
    const log: string[] = [];
    const { channel } = commandChannel([
      {
        type: "session.start",
        sessionId: scope.sessionId,
        agentId: "codex-acp",
        runtime: "cloud",
      },
      {
        type: "session.prompt",
        sessionId: scope.sessionId,
        turnId: "turn_cas_failure",
        text: "commit this",
      },
    ], log);
    const harness = createManagedAcpSupervisorHarness({
      connect: async () => channel,
      acpRuntime: fakeAcpRuntime(log),
      sessionPreparation: {
        async prepare() { return { agent: { command: "codex-acp" } }; },
      },
      sessionState: {
        async beforeStart(command) { return { command }; },
        async onReady() {},
        async checkpoint(input) {
          log.push(`state:checkpoint:${input.turnId ?? "shutdown"}`);
        },
        async release(input) { log.push(`state:release:${input.reason}`); },
      },
    });

    const run = await harness.start({
      scope,
      harness: { id: "acp", version: "1" },
      workspacePath: "/workspace",
      outputPath: null,
      async checkpoint(input) {
        log.push(`host:checkpoint:${input.turnId ?? "shutdown"}`);
        if (input.turnId !== undefined) throw new Error("workspace CAS failed");
      },
      signal: new AbortController().signal,
    });

    await expect(run.completed).rejects.toThrow("workspace CAS failed");
    expect(log.indexOf("state:checkpoint:turn_cas_failure")).toBeLessThan(
      log.indexOf("publish:session.complete"),
    );
    expect(log.indexOf("publish:session.complete")).toBeLessThan(
      log.indexOf("host:checkpoint:turn_cas_failure"),
    );
    await run.stop("failed");
    expect(log).toContain("state:checkpoint:shutdown");
    expect(log).toContain("state:release:shutdown");
  });

  it("releases materialized native state when ACP startup fails before ready", async () => {
    const log: string[] = [];
    const { channel } = commandChannel([{
      type: "session.start",
      sessionId: scope.sessionId,
      agentId: "codex-acp",
      runtime: "cloud",
    }], log);
    const harness = createManagedAcpSupervisorHarness({
      connect: async () => channel,
      acpRuntime: {
        async start() {
          throw new Error("ACP failed during initialize");
        },
      },
      sessionPreparation: {
        async prepare() { return { agent: { command: "codex-acp" } }; },
      },
      sessionState: {
        async beforeStart(command) {
          log.push("state:materialized");
          return { command };
        },
        async onReady() { log.push("state:ready"); },
        async checkpoint() { log.push("state:checkpoint"); },
        async release(input) { log.push(`state:release:${input.reason}`); },
      },
    });

    const run = await startHarness(harness);
    await expect(run.completed).resolves.toEqual({ exitCode: 0 });
    await run.drain();

    expect(log).toContain("publish:session.error");
    expect(log).not.toContain("state:ready");
    expect(log).not.toContain("state:checkpoint");
    expect(log.filter((entry) => entry === "state:release:shutdown")).toHaveLength(1);
  });

  it("fails closed when the control stream ends without an explicit work completion", async () => {
    const log: string[] = [];
    const channel = abruptlyClosedChannel([{
      type: "session.start",
      sessionId: scope.sessionId,
      agentId: "codex-acp",
      runtime: "cloud",
    }], log);
    const harness = createManagedAcpSupervisorHarness({
      connect: async () => channel,
      acpRuntime: fakeAcpRuntime(log),
      sessionPreparation: { async prepare() { return { agent: { command: "codex-acp" } }; } },
      sessionState: inertState(),
    });

    const run = await startHarness(harness);
    await expect(run.completed).rejects.toThrow(
      "Harness control stream closed before control.complete",
    );
    await run.stop("failed");
  });

  it("stops a blocked control stream, checkpoints once, and treats abort as clean exit", async () => {
    const log: string[] = [];
    let releaseCommands!: () => void;
    const waiting = new Promise<void>((resolve) => { releaseCommands = resolve; });
    const channel: ManagedHarnessControlChannel = {
      async *commands(signal) {
        yield {
          type: "session.start",
          sessionId: scope.sessionId,
          agentId: "codex-acp",
          runtime: "cloud",
        };
        await Promise.race([
          waiting,
          new Promise<void>((_, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
        ]);
      },
      async publish(event) { log.push(`publish:${event.type}`); },
      async close() { log.push("control:close"); releaseCommands(); },
    };
    const state: ManagedHarnessSessionStatePort = {
      async beforeStart(command) { return { command }; },
      async onReady() {},
      async checkpoint() { log.push("state:checkpoint"); },
      async release(input) { log.push(`state:release:${input.reason}`); },
    };
    const harness = createManagedAcpSupervisorHarness({
      connect: async () => channel,
      acpRuntime: fakeAcpRuntime(log),
      sessionPreparation: { async prepare() { return { agent: { command: "codex-acp" } }; } },
      sessionState: state,
      drainDeadlineMs: 100,
      drainPollIntervalMs: 1,
      abortGraceMs: 0,
    });

    const run = await startHarness(harness);
    await vi.waitFor(() => expect(log).toContain("publish:session.ready"));
    await run.stop("aborted");
    await expect(run.completed).resolves.toEqual({ exitCode: 0 });
    await run.stop("failed");

    expect(log.filter((entry) => entry === "state:checkpoint")).toHaveLength(1);
    expect(log).toContain("state:release:shutdown");
    expect(log.filter((entry) => entry === "control:close")).toHaveLength(1);
  });

  it("suppresses an in-flight publication failure after the Work is fenced", async () => {
    const log: string[] = [];
    let publicationStarted!: () => void;
    const started = new Promise<void>((resolve) => { publicationStarted = resolve; });
    let rejectPublication!: (error: Error) => void;
    const publication = new Promise<void>((_, reject) => { rejectPublication = reject; });
    const channel: ManagedHarnessControlChannel = {
      async *commands(signal) {
        yield {
          type: "session.start",
          sessionId: scope.sessionId,
          agentId: "codex-acp",
          runtime: "cloud",
        };
        await new Promise<void>((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
      async publish(event) {
        log.push(`publish:${event.type}`);
        if (event.type === "session.ready") {
          publicationStarted();
          await publication;
        }
      },
      async close() { log.push("control:close"); },
    };
    const harness = createManagedAcpSupervisorHarness({
      connect: async () => channel,
      acpRuntime: fakeAcpRuntime(log),
      sessionPreparation: { async prepare() { return { agent: { command: "codex-acp" } }; } },
      sessionState: inertState(),
      drainDeadlineMs: 100,
      drainPollIntervalMs: 1,
      abortGraceMs: 0,
    });

    const run = await startHarness(harness);
    await started;
    const stopped = run.stop("aborted");
    rejectPublication(new Error("late control-plane failure"));
    await expect(stopped).resolves.toBeUndefined();
    await expect(run.completed).resolves.toEqual({ exitCode: 0 });
    expect(log).toContain("control:close");
  });

  it("inherits an already-aborted parent signal", async () => {
    const log: string[] = [];
    const { channel } = commandChannel([{
      type: "session.start",
      sessionId: scope.sessionId,
      agentId: "codex-acp",
      runtime: "cloud",
    }], log);
    const parent = new AbortController();
    parent.abort(new Error("host already stopped"));
    const harness = createManagedAcpSupervisorHarness({
      connect: async ({ signal }) => {
        expect(signal.aborted).toBe(true);
        return channel;
      },
      acpRuntime: fakeAcpRuntime(log),
      sessionPreparation: { async prepare() { return { agent: { command: "codex-acp" } }; } },
      sessionState: inertState(),
    });

    const run = await harness.start({
      scope,
      harness: { id: "acp", version: "1" },
      workspacePath: "/workspace",
      outputPath: null,
      checkpoint: async () => {},
      signal: parent.signal,
    });
    await expect(run.completed).resolves.toEqual({ exitCode: 0 });
    await run.drain();
    await run.drain();
  });

  it.each([
    [{ drainDeadlineMs: -1 }, "drainDeadlineMs must be a non-negative integer"],
    [{ drainDeadlineMs: 1.5 }, "drainDeadlineMs must be a non-negative integer"],
    [{ drainPollIntervalMs: 0 }, "drainPollIntervalMs must be a positive integer"],
    [{ drainPollIntervalMs: 1.5 }, "drainPollIntervalMs must be a positive integer"],
    [{ abortGraceMs: -1 }, "abortGraceMs must be a non-negative integer"],
    [{ abortGraceMs: 1.5 }, "abortGraceMs must be a non-negative integer"],
  ] as const)("rejects invalid timing option %j", (timing, message) => {
    expect(() => createManagedAcpSupervisorHarness({
      connect: async () => { throw new Error("unused"); },
      acpRuntime: fakeAcpRuntime([]),
      sessionPreparation: { async prepare() { return { agent: { command: "unused" } }; } },
      sessionState: inertState(),
      ...timing,
    })).toThrow(message);
  });
});

describe("managed dispatch and completion extensions", () => {
  const start: ManagedHarnessControlMessage = { type: "session.start", sessionId: scope.sessionId, agentId: "acp", runtime: "cloud" };
  const prompt = (id: string): ManagedHarnessControlMessage => ({ type: "session.prompt", sessionId: scope.sessionId, turnId: id, text: id });
  const setup = (channel: ManagedHarnessControlChannel, log: string[], extra: Partial<Parameters<typeof createManagedAcpSupervisorHarness>[0]> = {}) => createManagedAcpSupervisorHarness({
    connect: async () => channel, acpRuntime: fakeAcpRuntime(log), sessionPreparation: { async prepare() { return { agent: { command: "acp" } }; } }, sessionState: inertState(), ...extra,
  });

  it("awaits consumption in prompt order and does not consume a waiting prompt", async () => {
    const log: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { channel } = commandChannel([start, prompt("first"), prompt("second")], log);
    channel.beforeDispatch = async command => { log.push("consume:" + command.turnId); await gate; };
    const run = await startHarness(setup(channel, log));
    await vi.waitFor(() => expect(log).toContain("consume:first"));
    expect(log).not.toContain("consume:second");
    expect(log.filter(item => item.startsWith("acp:prompt:"))).toEqual([]);
    release();
    await run.completed;
    expect(log.indexOf("acp:prompt:first")).toBeLessThan(log.indexOf("consume:second"));
    expect(log.indexOf("consume:second")).toBeLessThan(log.indexOf("acp:prompt:second"));
    await run.drain();
  });

  it("fails closed at the consumption hook and retries the same input identity", async () => {
    const ids: string[] = [];
    for (const fails of [true, false]) {
      const log: string[] = [];
      const { channel } = commandChannel([start, prompt("stable")], log);
      channel.beforeDispatch = async command => { ids.push(command.turnId); if (fails) throw new Error("fenced"); };
      const run = await startHarness(setup(channel, log));
      if (fails) {
        await expect(run.completed).rejects.toThrow("fenced");
        expect(log).not.toContain("acp:prompt:stable");
        await run.stop("failed");
      } else { await run.completed; await run.drain(); }
    }
    expect(ids).toEqual(["stable", "stable"]);
  });

  it("reports hook failure even while the HTTP-like command stream stays open", async () => {
    const log: string[] = [];
    const { channel } = commandChannel([], log);
    channel.commands = async function* (signal) {
      yield start;
      yield prompt("fenced");
      await new Promise<void>(resolve => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
    };
    channel.beforeDispatch = async () => { throw new Error("lost work fence"); };
    const run = await startHarness(setup(channel, log));
    let result: unknown;
    void run.completed.catch(error => { result = error; });
    try {
      await vi.waitFor(() => expect(result).toBeInstanceOf(Error));
      expect((result as Error).message).toBe("lost work fence");
      expect(log).not.toContain("acp:prompt:fenced");
    } finally { await run.stop("failed"); }
  });

  it("keeps hooked native steer live and awaits its receipt before control completion", async () => {
    const log: string[] = [];
    let release!: () => void, received!: () => void;
    const receipt = new Promise<void>(resolve => { received = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { channel } = commandChannel([start, prompt("active"), { type: "session.steer", sessionId: scope.sessionId, eventId: "steer", text: "steer" }], log);
    channel.beforeDispatch = async command => { log.push("gate:" + command.turnId); };
    channel.onConsumed = async (command, acceptance) => {
      log.push("receipt:" + command.turnId + ":" + acceptance);
      if (command.turnId === "steer") await receipt;
    };
    const run = await startHarness(setup(channel, log, { acpRuntime: fakeAcpRuntime(log, { promptGate: gate }) }));
    let done = false; void run.completed.then(() => { done = true; });
    try {
      await vi.waitFor(() => expect(log).toContain("receipt:steer:injected"));
      expect(log).toContain("acp:steer:steer");
      expect(log).not.toContain("acp:prompt:steer");
      release(); await new Promise(resolve => setTimeout(resolve, 0));
      expect(done).toBe(false);
      received(); await run.completed;
    } finally { release(); received(); await run.stop("aborted"); }
  });

  it("does not dispatch a queued input cancelled before its consumption hook", async () => {
    const log: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { channel } = commandChannel([start, prompt("first"), prompt("second"), { type: "session.cancel", sessionId: scope.sessionId, turnId: "second" }], log);
    channel.beforeDispatch = async command => { log.push("consume:" + command.turnId); };
    const run = await startHarness(setup(channel, log, { acpRuntime: fakeAcpRuntime(log, { promptGate: gate }) }));
    await vi.waitFor(() => expect(log).toContain("acp:prompt:first"));
    release();
    await run.completed;
    expect(log).not.toContain("consume:second");
    expect(log).not.toContain("acp:prompt:second");
    await run.drain();
  });

  it("runs two revisions outside the event chain and publishes only the final canonical completion", async () => {
    const log: string[] = [];
    const canonical = { eventId: "outcome", event: { id: "outcome", type: "user.define_outcome", processed_at: null }, outcome: { id: "goal", description: "ship", rubric: { checks: ["tests"] }, maxIterations: 3 } };
    const { channel, published } = commandChannel([start, { ...prompt("outcome"), input: canonical } as ManagedHarnessControlMessage], log);
    const run = await startHarness(setup(channel, log, {
      async onTurnComplete({ command, runRevision, flush }) {
        expect(command.input).toEqual(canonical);
        expect(command.turnId).toBe("outcome");
        expect(published.filter(event => event.type === "session.complete")).toHaveLength(0);
        await runRevision({ turnId: "revision-1", text: "revise 1" });
        await flush();
        expect(published.filter(event => event.type === "session.complete")).toHaveLength(0);
        await runRevision({ turnId: "revision-2", text: "revise 2" });
        log.push("evaluation:done");
      },
    }));
    await run.completed;
    expect(log.filter(entry => entry.startsWith("acp:prompt:"))).toEqual(["acp:prompt:outcome", "acp:prompt:revise 1", "acp:prompt:revise 2"]);
    expect(published.filter(event => event.type === "session.complete")).toEqual([{ type: "session.complete", sessionId: scope.sessionId, turnId: "outcome" }]);
    expect(log.indexOf("evaluation:done")).toBeLessThan(log.indexOf("publish:session.complete"));
    let id = 0;
    const projector = new ManagedAcpEventProjector({ nextEventId: () => `e${++id}`, now: () => new Date(0) });
    const wire = published.flatMap(event => event.type === "session.warning" ? [] : projector.project(event));
    expect(wire.filter(event => event.type === "session.status_idle")).toHaveLength(1);
    await run.drain();
  });

  it("routes a canonical cancel to the active internal revision", async () => {
    const log: string[] = [];
    let began!: () => void;
    const revisionStarted = new Promise<void>(resolve => { began = resolve; });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { channel } = commandChannel([], log);
    channel.commands = async function* () {
      yield start;
      yield prompt("outcome");
      await revisionStarted;
      yield { type: "session.cancel", sessionId: scope.sessionId, turnId: "outcome" };
      yield { type: "control.complete", workId: scope.workId };
    };
    const run = await startHarness(setup(channel, log, {
      acpRuntime: fakeAcpRuntime(log, {
        promptGateFor: async text => { if (text === "revision") { began(); await gate; } },
        onCancel: () => { log.push("revision:cancelled"); release(); },
      }),
      async onTurnComplete({ runRevision, signal }) {
        await runRevision({ turnId: "revision-1", text: "revision" });
        expect(signal.aborted).toBe(true);
      },
    }));
    try {
      await vi.waitFor(() => expect(log).toContain("revision:cancelled"));
      await run.completed;
    } finally { release(); await run.stop("aborted"); }
  });

  it("cancels outcome evaluation before any further revision and flushes before completion", async () => {
    const log: string[] = [];
    const { channel, published } = commandChannel([start, prompt("outcome")], log);
    const run = await startHarness(setup(channel, log, {
      async onTurnComplete({ cancel, signal, runRevision, flush }) {
        log.push("evaluation:cancel");
        await cancel();
        expect(signal.aborted).toBe(true);
        await expect(runRevision({ turnId: "forbidden", text: "no" })).rejects.toThrow();
        await flush();
        expect(published.filter(event => event.type === "session.complete")).toHaveLength(0);
      },
    }));
    await run.completed;
    expect(log).toContain("evaluation:cancel");
    expect(log).not.toContain("acp:prompt:no");
    // Cancelling the outcome also cancels the owning turn. Flushing prior
    // output must not revive its held successful completion.
    expect(published.filter(event => event.type === "session.complete")).toHaveLength(0);
    await run.drain();
  });
});

function inertState(): ManagedHarnessSessionStatePort {
  return {
    async beforeStart(command) { return { command }; },
    async onReady() {},
    async checkpoint() {},
    async release() {},
  };
}

async function startHarness(
  harness: ReturnType<typeof createManagedAcpSupervisorHarness>,
) {
  return harness.start({
    scope,
    harness: { id: "acp", version: "1" },
    workspacePath: "/workspace",
    outputPath: null,
    checkpoint: async () => {},
    signal: new AbortController().signal,
  });
}
