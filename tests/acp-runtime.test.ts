import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  RequestError,
  ndJsonStream,
  type Agent,
  type ContentBlock,
} from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";
import { forkSupport } from "../src/acp-runtime/fork-support.js";
import {
  AcpSessionImpl,
  acpForkRequestMeta,
  mergeClientCapabilities,
  sessionConfigOptionsFromResponse,
} from "../src/acp-runtime/session.js";
import type { ChildHandle } from "../src/acp-runtime/types.js";

describe("shared ACP session runtime", () => {
  // Replacing the RPC rejection with only String(error) loses the machine-
  // readable reason that hosts need to distinguish authentication from failure.
  it.each([
    {
      name: "authentication-required RPC code",
      error: new RequestError(-32000, "Authentication required"),
      want: {
        message: "Authentication required",
        code: -32000,
      },
    },
    {
      name: "provider data carried by an internal-error RPC response",
      error: new RequestError(-32603, "Internal error", {
        codexErrorInfo: "unauthorized",
        message: "Please sign in again.",
      }),
      want: {
        message: "Internal error",
        code: -32603,
        data: {
          codexErrorInfo: "unauthorized",
          message: "Please sign in again.",
        },
      },
    },
    {
      name: "ordinary agent errors without inventing authentication",
      error: new Error("Temporary backend failure"),
      want: {
        message: "Internal error",
        code: -32603,
        data: { details: expect.stringContaining("Temporary backend failure") },
      },
    },
  ])("preserves $name in the prompt failure stream", async ({ error, want }) => {
    const harness = createHarness(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "prompt-error-session" };
      },
      async prompt() {
        throw error;
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "prompt-error-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });
    const events: unknown[] = [];
    try {
      await session.init();
      const drain = async () => {
        for await (const event of session.prompt("hello")) events.push(event);
      };
      await expect(drain()).rejects.toMatchObject({
        cause: { code: want.code, message: want.message },
      });
    } finally {
      await session.dispose();
    }

    expect(events).toEqual([{
      type: "promptError",
      error: `RequestError: ${want.message}`,
      errorDetails: want,
    }]);
  });

  it("filters HTTP and SSE MCP servers by the agent's advertised transports", async () => {
    let sentMcpServers: unknown;
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            mcpCapabilities: { http: true, sse: false },
          },
        };
      },
      async newSession(params) {
        sentMcpServers = params.mcpServers;
        return { sessionId: "mcp-capabilities-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "mcp-capabilities-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        mcpServers: [
          { type: "stdio", name: "filesystem", command: "fs", args: [], env: [] },
          { type: "http", name: "browser", url: "http://127.0.0.1:1234/mcp", headers: [] },
          { type: "sse", name: "legacy", url: "http://127.0.0.1:1235/sse", headers: [] },
        ] as never,
      },
    });

    await session.init();
    await session.dispose();

    expect(sentMcpServers).toEqual([
      { name: "filesystem", command: "fs", args: [], env: [] },
      { type: "http", name: "browser", url: "http://127.0.0.1:1234/mcp", headers: [] },
    ]);
  });

  it("forwards adapter request metadata through session/new", async () => {
    let newSessionRequest:
      | { _meta?: Record<string, unknown> | null }
      | undefined;
    const harness = createHarness(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession(params) {
        newSessionRequest = params;
        return { sessionId: "adapter-meta-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "adapter-meta-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        sessionRequestMeta: {
          claudeCode: {
            emitRawSDKMessages: [
              { type: "system", subtype: "task_notification" },
            ],
          },
        },
      },
    });

    await session.init();
    await session.dispose();

    expect(newSessionRequest?._meta).toEqual({
      claudeCode: {
        emitRawSDKMessages: [
          { type: "system", subtype: "task_notification" },
        ],
      },
    });
  });

  it("sends ACP additionalDirectories through the shared session/new contract", async () => {
    let newSessionRequest:
      | { cwd: string; additionalDirectories?: string[] }
      | undefined;
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            sessionCapabilities: { additionalDirectories: {} },
          },
        };
      },
      async newSession(params) {
        newSessionRequest = params;
        return { sessionId: "multi-root-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "multi-root-session",
      options: {
        agent: { command: "fake-agent", cwd: "/work/main" },
        additionalDirectories: ["/work/docs", "/work/backend"],
      },
    });

    await session.init();
    expect(session.supportsAdditionalDirectories).toBe(true);
    await session.dispose();

    expect(newSessionRequest).toMatchObject({
      cwd: "/work/main",
      additionalDirectories: ["/work/docs", "/work/backend"],
    });
  });

  it("rejects additionalDirectories before session/new when support was not advertised", async () => {
    let newSessionCalled = false;
    const harness = createHarness(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        newSessionCalled = true;
        return { sessionId: "single-root-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "single-root-session",
      options: {
        agent: { command: "fake-agent", cwd: "/work/main" },
        additionalDirectories: ["/work/docs"],
      },
    });

    await expect(session.init()).rejects.toThrow(
      "ACP agent does not support additional workspace directories",
    );
    expect(session.supportsAdditionalDirectories).toBe(false);
    await session.dispose();
    expect(newSessionCalled).toBe(false);
  });

  it("exposes the legacy-compatible mode state returned by session/new", async () => {
    const modes = {
      currentModeId: "ask",
      availableModes: [
        { id: "ask", name: "Ask" },
        { id: "code", name: "Code" },
      ],
    };
    const harness = createHarness(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "new-modes-session", modes };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "new-modes-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    const observed = (session as AcpSessionImpl & { modes?: unknown }).modes;
    await session.dispose();

    expect(observed).toEqual(modes);
  });

  it("preserves adapter metadata returned by session/new", async () => {
    const setupMeta = {
      piAcp: { startupInfo: "Loaded AGENTS.md" },
    };
    const harness = createHarness(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "new-meta-session", _meta: setupMeta };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "new-meta-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    const observed = session.sessionSetupMeta;
    await session.dispose();

    expect(observed).toEqual(setupMeta);
  });

  it("exposes the legacy-compatible mode state returned by session/load", async () => {
    const modes = {
      currentModeId: "review",
      availableModes: [
        { id: "review", name: "Review" },
        { id: "code", name: "Code" },
      ],
    };
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: { loadSession: true },
        };
      },
      async loadSession() {
        return { modes };
      },
      async newSession() {
        throw new Error("session/new must not be used after a successful load");
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "load-modes-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        resumeAcpSessionId: "existing-modes-session",
      },
    });

    await session.init();
    const observed = (session as AcpSessionImpl & { modes?: unknown }).modes;
    await session.dispose();

    expect(observed).toEqual(modes);
  });

  it("prefers ACP session/resume over replaying history through session/load", async () => {
    let resumeRequest:
      | { sessionId: string; cwd: string; additionalDirectories?: string[] }
      | undefined;
    let loadCalls = 0;
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            loadSession: true,
            sessionCapabilities: {
              resume: {},
              additionalDirectories: {},
            },
          },
        };
      },
      async resumeSession(params) {
        resumeRequest = params;
        return {
          _meta: { piAcp: { startupInfo: "Resumed context" } },
          configOptions: [],
          modes: {
            currentModeId: "code",
            availableModes: [{ id: "code", name: "Code" }],
          },
        };
      },
      async loadSession() {
        loadCalls += 1;
        return {};
      },
      async newSession() {
        throw new Error("session/new must not run after resume succeeds");
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "resume-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        resumeAcpSessionId: "existing-session",
        additionalDirectories: ["/tmp/docs"],
      },
    });

    await session.init();
    const observedModes = session.modes;
    const observedSetupMeta = session.sessionSetupMeta;
    await session.dispose();

    expect(resumeRequest).toEqual({
      sessionId: "existing-session",
      cwd: "/tmp/openma",
      mcpServers: [],
      additionalDirectories: ["/tmp/docs"],
    });
    expect(loadCalls).toBe(0);
    expect(observedModes?.currentModeId).toBe("code");
    expect(observedSetupMeta).toEqual({
      piAcp: { startupInfo: "Resumed context" },
    });
  });

  it("closes a negotiated ACP session before disposing its process", async () => {
    const lifecycle: string[] = [];
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            sessionCapabilities: { close: {} },
          },
        };
      },
      async newSession() {
        return { sessionId: "close-session" };
      },
      async closeSession(params) {
        lifecycle.push(`close:${params.sessionId}`);
        return {};
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const child = {
      ...harness.child,
      async kill(signal?: "SIGTERM" | "SIGKILL") {
        lifecycle.push(`kill:${signal}`);
        await harness.child.kill(signal);
      },
    };
    const session = new AcpSessionImpl({
      child,
      id: "close-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    await session.dispose();

    expect(lifecycle).toEqual(["close:close-session", "kill:SIGTERM"]);
  });

  it("exposes the legacy-compatible mode state returned by session/fork", async () => {
    const modes = {
      currentModeId: "architect",
      availableModes: [
        { id: "architect", name: "Architect" },
        { id: "code", name: "Code" },
      ],
    };
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: { sessionCapabilities: { fork: {} } },
        };
      },
      async unstable_forkSession() {
        return { sessionId: "forked-modes-session", modes };
      },
      async newSession() {
        throw new Error("session/new must not be used after a successful fork");
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "fork-modes-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        forkFromAcpSessionId: "parent-session",
      },
    });

    await session.init();
    const observed = (session as AcpSessionImpl & { modes?: unknown }).modes;
    await session.dispose();

    expect(observed).toEqual(modes);
  });

  it("updates the exposed legacy mode state after session/set_mode succeeds", async () => {
    let setModeRequest: { sessionId: string; modeId: string } | undefined;
    const harness = createHarness(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return {
          sessionId: "set-mode-session",
          modes: {
            currentModeId: "ask",
            availableModes: [
              { id: "ask", name: "Ask" },
              { id: "code", name: "Code" },
            ],
          },
        };
      },
      async setSessionMode(params) {
        setModeRequest = params;
        return {};
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "set-mode-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    await session.setMode("code");
    const observed = session.modes;
    await session.dispose();

    expect(setModeRequest).toEqual({ sessionId: "set-mode-session", modeId: "code" });
    expect(observed?.currentModeId).toBe("code");
  });

  it("exposes steering only when the agent negotiates the extension capability", async () => {
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          _meta: { steering: { supported: true } },
        };
      },
      async newSession() {
        return { sessionId: "steering-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));

    const session = new AcpSessionImpl({
      child: harness.child,
      id: "steering-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    expect(session.supportsSteering).toBe(true);
    await session.dispose();
  });

  it("sends negotiated steering through the extension method", async () => {
    let steeringRequest:
      | { method: string; params: Record<string, unknown> }
      | undefined;
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          _meta: { steering: { supported: true } },
        };
      },
      async newSession() {
        return { sessionId: "steering-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
      async extMethod(method, params) {
        steeringRequest = { method, params };
        return { outcome: "injected" };
      },
    }));

    const session = new AcpSessionImpl({
      child: harness.child,
      id: "steering-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });
    const blocks: ContentBlock[] = [
      { type: "text", text: "change direction" },
      { type: "resource_link", uri: "file:///tmp/brief.md", name: "brief" },
    ];

    await session.init();
    expect(typeof session.steer).toBe("function");
    const outcome = await session.steer(blocks);
    await session.dispose();

    expect(outcome).toBe("injected");
    expect(steeringRequest).toEqual({
      method: "_session/steering",
      params: {
        sessionId: "steering-session",
        prompt: blocks,
        _meta: { steering: { idleBehavior: "promptRequired" } },
      },
    });
  });

  it("refuses to send steering when the agent did not negotiate it", async () => {
    let extensionCalls = 0;
    const harness = createHarness(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "plain-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
      async extMethod() {
        extensionCalls += 1;
        return { outcome: "injected" };
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "plain-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    await expect(session.steer("do not send")).rejects.toThrow(
      "ACP agent did not negotiate _session/steering",
    );
    expect(extensionCalls).toBe(0);
    await session.dispose();
  });

  it("rejects an invalid steering extension outcome", async () => {
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          _meta: { steering: { supported: true } },
        };
      },
      async newSession() {
        return { sessionId: "invalid-steering-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
      async extMethod() {
        return { outcome: "unexpected" };
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "invalid-steering-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    await expect(session.steer("change direction")).rejects.toThrow(
      "Invalid _session/steering outcome: unexpected",
    );
    await session.dispose();
  });

  it("accepts the failed outcome used by Codex steering", async () => {
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          _meta: { steering: { supported: true } },
        };
      },
      async newSession() {
        return { sessionId: "failed-steering-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
      async extMethod() {
        return { outcome: "failed" };
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "failed-steering-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    await expect(session.steer("change direction")).resolves.toBe("failed");
    await session.dispose();
  });

  it("delivers post-init session updates emitted outside a prompt", async () => {
    const outOfBandUpdates: unknown[] = [];
    const harness = createHarness((conn) => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          _meta: { steering: { supported: true } },
        };
      },
      async newSession() {
        return {
          sessionId: "out-of-band-session",
          configOptions: [{
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "gpt-5.5",
            options: [
              { value: "gpt-5.5", name: "GPT-5.5" },
              { value: "gpt-5.6", name: "GPT-5.6" },
            ],
          }],
        };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
      async extMethod() {
        await conn.sessionUpdate({
          sessionId: "out-of-band-session",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "background answer" },
          },
        });
        await conn.sessionUpdate({
          sessionId: "out-of-band-session",
          update: {
            sessionUpdate: "session_info_update",
            _meta: { codex: { threadStatus: { type: "idle" } } },
          },
        });
        await conn.sessionUpdate({
          sessionId: "out-of-band-session",
          update: {
            sessionUpdate: "config_option_update",
            configOptions: [{
              id: "model",
              name: "Model",
              category: "model",
              type: "select",
              currentValue: "gpt-5.6",
              options: [
                { value: "gpt-5.5", name: "GPT-5.5" },
                { value: "gpt-5.6", name: "GPT-5.6" },
              ],
            }],
          },
        });
        return { outcome: "startedNewTurn" };
      },
    }));

    const session = new AcpSessionImpl({
      child: harness.child,
      id: "out-of-band-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        onOutOfBandSessionUpdate: (update) => outOfBandUpdates.push(update),
      },
    });

    await session.init();
    await expect(session.steer("continue after the race")).resolves.toBe(
      "startedNewTurn",
    );
    expect(session.configOptions).toEqual([
      expect.objectContaining({ id: "model", currentValue: "gpt-5.6" }),
    ]);
    await session.dispose();

    expect(outOfBandUpdates).toEqual([
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "background answer" },
      },
      {
        sessionUpdate: "session_info_update",
        _meta: { codex: { threadStatus: { type: "idle" } } },
      },
      {
        sessionUpdate: "config_option_update",
        configOptions: [
          expect.objectContaining({ id: "model", currentValue: "gpt-5.6" }),
        ],
      },
    ]);
  });

  it("can send ACP session/cancel for an extension-owned background turn", async () => {
    let cancelRequest: { sessionId: string } | undefined;
    const harness = createHarness(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "background-turn-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel(params) {
        cancelRequest = params;
      },
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "background-turn-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    const cancelCurrentTurn = (
      session as AcpSessionImpl & {
        cancelCurrentTurn?: () => Promise<void>;
      }
    ).cancelCurrentTurn;
    if (typeof cancelCurrentTurn !== "function") {
      await session.dispose();
      expect(cancelCurrentTurn).toBeTypeOf("function");
      return;
    }
    await cancelCurrentTurn.call(session);
    await session.dispose();

    expect(cancelRequest).toEqual({ sessionId: "background-turn-session" });
  });

  it("advertises supported ACP projections and nested transcript extensions during initialize", async () => {
    let initializeRequest: { clientCapabilities?: Record<string, unknown> } | undefined;
    const harness = createHarness((conn) => ({
      async initialize(params) {
        initializeRequest = params as typeof initializeRequest;
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "nested-transcript-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));

    const session = new AcpSessionImpl({
      child: harness.child,
      id: "nested-transcript-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    await session.dispose();

    expect(initializeRequest?.clientCapabilities).toMatchObject({
      session: {
        configOptions: {
          boolean: {},
        },
      },
      plan: {},
      _meta: {
        "subagent-transcript": true,
        terminal_output: true,
      },
    });
  });

  it("retains the complete ACP initialize response for canonical session capabilities", async () => {
    const agentCapabilities = {
      loadSession: true,
      promptCapabilities: { image: true, embeddedContext: true },
      mcpCapabilities: { http: true, sse: false },
      sessionCapabilities: {
        list: {},
        delete: {},
        resume: {},
        close: {},
        additionalDirectories: {},
      },
      auth: { logout: {} },
      _meta: { "vendor.dev/capability": true },
    };
    const initializeMeta = {
      steering: { supported: true },
      "vendor.dev/runtime": { build: "2026.08" },
    };
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentInfo: { name: "fixture-agent", version: "1.2.3" },
          agentCapabilities,
          _meta: initializeMeta,
        };
      },
      async newSession() {
        return { sessionId: "initialize-evidence-session" };
      },
      async closeSession() {
        return {};
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "initialize-evidence-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    const evidence = {
      protocolVersion: (session as AcpSessionImpl & { protocolVersion?: unknown }).protocolVersion,
      agentInfo: session.agentInfo,
      agentCapabilities: (session as AcpSessionImpl & { agentCapabilities?: unknown }).agentCapabilities,
      initializeMeta: (session as AcpSessionImpl & { initializeMeta?: unknown }).initializeMeta,
    };
    await session.dispose();

    expect(evidence).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: { name: "fixture-agent", version: "1.2.3" },
      agentCapabilities,
      initializeMeta,
    });
  });

  it("uses the ACP session lifecycle and streams only the active prompt", async () => {
    const harness = createHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: { loadSession: true } };
      },
      async loadSession(params) {
        await conn.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "replayed history" },
          },
        });
        return {};
      },
      async newSession() {
        throw new Error("newSession must not be used when loading is supported");
      },
      async prompt(params) {
        await conn.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "fresh answer" },
          },
        });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));

    const session = new AcpSessionImpl({
      child: harness.child,
      id: "shared-acp-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        resumeAcpSessionId: "existing-session",
        mcpServers: [],
      },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("continue")) events.push(event);
    await session.dispose();

    expect(session.acpSessionId).toBe("existing-session");
    expect(events).toContainEqual(
      expect.objectContaining({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "fresh answer" },
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ content: { type: "text", text: "replayed history" } }),
    );
  });

  it("preserves notification-scoped ACP metadata without overwriting update metadata", async () => {
    const harness = createHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "notification-meta-session" };
      },
      async prompt(params) {
        await conn.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "hello" },
            _meta: { claudeCode: { parentToolUseId: "task-1" } },
          },
          _meta: {
            traceparent: "00-abc-def-01",
            "vendor.dev/notification": { sequence: 7 },
          },
        });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "notification-meta-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("hello")) events.push(event);
    await session.dispose();

    expect(events).toContainEqual(expect.objectContaining({
      sessionUpdate: "agent_message_chunk",
      _meta: { claudeCode: { parentToolUseId: "task-1" } },
      "_openma.acp.notification": {
        session_id: "notification-meta-session",
        meta: {
          traceparent: "00-abc-def-01",
          "vendor.dev/notification": { sequence: 7 },
        },
      },
    }));
  });

  it("retains an agent-to-client ACP extension notification as an adapter event", async () => {
    const harness = createHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "extension-notification-session" };
      },
      async prompt() {
        await conn.extNotification("_vendor.dev/background_progress", {
          sessionId: "extension-notification-session",
          taskId: "task-7",
          progress: 0.5,
        });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "extension-notification-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("run")) events.push(event);
    await session.dispose();

    expect(events).toContainEqual({
      type: "acp.extension_notification",
      method: "_vendor.dev/background_progress",
      params: {
        sessionId: "extension-notification-session",
        taskId: "task-7",
        progress: 0.5,
      },
    });
    expect(events).toContainEqual({
      type: "acp.client_notification",
      method: "_vendor.dev/background_progress",
      params: {
        sessionId: "extension-notification-session",
        taskId: "task-7",
        progress: 0.5,
      },
    });
  });

  it("retains an unsupported agent-to-client extension request before returning method-not-found", async () => {
    let rejectionCode: number | undefined;
    const harness = createHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "unsupported-extension-request-session" };
      },
      async prompt() {
        try {
          await conn.extMethod("cursor/task", {
            toolCallId: "task-call-1",
            agentId: "cursor-child-1",
            subagentType: "explore",
          });
        } catch (error) {
          rejectionCode = (error as { code?: number }).code;
        }
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "unsupported-extension-request-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("run")) events.push(event);
    await session.dispose();

    expect(rejectionCode).toBe(-32601);
    expect(events).toContainEqual({
      type: "acp.extension_request",
      method: "cursor/task",
      params: {
        toolCallId: "task-call-1",
        agentId: "cursor-child-1",
        subagentType: "explore",
      },
    });
    expect(events).toContainEqual({
      type: "acp.client_error",
      requestId: "client-request-1",
      method: "cursor/task",
      error: {
        code: -32601,
        message: "Method not found",
      },
    });
  });

  it("delegates an agent-to-client ACP extension request to the host adapter", async () => {
    let response: Record<string, unknown> | undefined;
    const harness = createHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "extension-request-session" };
      },
      async prompt() {
        response = await conn.extMethod("_vendor.dev/subagent_message", {
          childId: "agent-2",
          text: "new direction",
        });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "extension-request-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        clientCallbacks: {
          extensionRequest: async (method, params) => ({
            accepted: method === "_vendor.dev/subagent_message",
            childId: params.childId,
          }),
        },
      },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("message child")) events.push(event);
    await session.dispose();

    expect(response).toEqual({ accepted: true, childId: "agent-2" });
    expect(events).toContainEqual({
      type: "acp.client_request",
      requestId: "client-request-1",
      method: "_vendor.dev/subagent_message",
      params: { childId: "agent-2", text: "new direction" },
    });
    expect(events).toContainEqual({
      type: "acp.client_response",
      requestId: "client-request-1",
      method: "_vendor.dev/subagent_message",
      result: { accepted: true, childId: "agent-2" },
    });
  });

  it("retains every standard agent-to-client callback request and response in the session event stream", async () => {
    const harness = createHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "callback-audit-session" };
      },
      async prompt() {
        await conn.requestPermission({
          sessionId: "callback-audit-session",
          toolCall: {
            toolCallId: "permission-tool",
            title: "Permission tool",
          },
          options: [{
            kind: "allow_once",
            name: "Allow once",
            optionId: "allow",
          }],
        });
        await conn.readTextFile({
          sessionId: "callback-audit-session",
          path: "/tmp/openma/input.txt",
        });
        await conn.writeTextFile({
          sessionId: "callback-audit-session",
          path: "/tmp/openma/output.txt",
          content: "written",
        });
        const terminal = await conn.createTerminal({
          sessionId: "callback-audit-session",
          command: "printf",
          args: ["hello"],
        });
        await terminal.currentOutput();
        await terminal.waitForExit();
        await terminal.kill();
        await terminal.release();
        await conn.unstable_createElicitation({
          mode: "form",
          sessionId: "callback-audit-session",
          message: "Choose",
          requestedSchema: {
            type: "object",
            properties: {
              answer: { type: "string" },
            },
          },
        });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "callback-audit-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        clientCallbacks: {
          requestPermission: async () => ({
            outcome: { outcome: "selected", optionId: "allow" },
          }),
          readTextFile: async () => ({ content: "read" }),
          writeTextFile: async () => ({}),
          createTerminal: async () => ({ terminalId: "terminal-1" }),
          terminalOutput: async () => ({
            output: "hello",
            truncated: false,
            exitStatus: { exitCode: 0, signal: null },
          }),
          waitForTerminalExit: async () => ({ exitCode: 0, signal: null }),
          killTerminal: async () => ({}),
          releaseTerminal: async () => ({}),
          createElicitation: async () => ({
            action: "accept",
            content: { answer: "yes" },
          }),
        },
      },
    });

    await session.init();
    const events: Array<Record<string, unknown>> = [];
    for await (const event of session.prompt("audit callbacks")) {
      events.push(event as Record<string, unknown>);
    }
    await session.dispose();

    const lifecycle = events
      .filter((event) =>
        event.type === "acp.client_request"
        || event.type === "acp.client_response")
      .map((event) => ({
        type: event.type,
        requestId: event.requestId,
        method: event.method,
      }));
    expect(lifecycle).toEqual([
      { type: "acp.client_request", requestId: "client-request-1", method: "session/request_permission" },
      { type: "acp.client_response", requestId: "client-request-1", method: "session/request_permission" },
      { type: "acp.client_request", requestId: "client-request-2", method: "fs/read_text_file" },
      { type: "acp.client_response", requestId: "client-request-2", method: "fs/read_text_file" },
      { type: "acp.client_request", requestId: "client-request-3", method: "fs/write_text_file" },
      { type: "acp.client_response", requestId: "client-request-3", method: "fs/write_text_file" },
      { type: "acp.client_request", requestId: "client-request-4", method: "terminal/create" },
      { type: "acp.client_response", requestId: "client-request-4", method: "terminal/create" },
      { type: "acp.client_request", requestId: "client-request-5", method: "terminal/output" },
      { type: "acp.client_response", requestId: "client-request-5", method: "terminal/output" },
      { type: "acp.client_request", requestId: "client-request-6", method: "terminal/wait_for_exit" },
      { type: "acp.client_response", requestId: "client-request-6", method: "terminal/wait_for_exit" },
      { type: "acp.client_request", requestId: "client-request-7", method: "terminal/kill" },
      { type: "acp.client_response", requestId: "client-request-7", method: "terminal/kill" },
      { type: "acp.client_request", requestId: "client-request-8", method: "terminal/release" },
      { type: "acp.client_response", requestId: "client-request-8", method: "terminal/release" },
      { type: "acp.client_request", requestId: "client-request-9", method: "elicitation/create" },
      { type: "acp.client_response", requestId: "client-request-9", method: "elicitation/create" },
    ]);
    expect(events).toContainEqual({
      type: "acp.client_response",
      requestId: "client-request-1",
      method: "session/request_permission",
      result: { outcome: { outcome: "selected", optionId: "allow" } },
    });
  });

  it("retains a failed agent-to-client callback before propagating its ACP error", async () => {
    let readRejected = false;
    const harness = createHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "callback-error-session" };
      },
      async prompt() {
        try {
          await conn.readTextFile({
            sessionId: "callback-error-session",
            path: "/tmp/openma/missing.txt",
          });
        } catch {
          readRejected = true;
        }
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "callback-error-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        clientCallbacks: {
          readTextFile: async () => {
            throw new Error("file unavailable");
          },
        },
      },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("read")) events.push(event);
    await session.dispose();

    expect(readRejected).toBe(true);
    expect(events).toContainEqual({
      type: "acp.client_error",
      requestId: "client-request-1",
      method: "fs/read_text_file",
      error: { message: "file unavailable" },
    });
  });

  it("exposes negotiated ACP session-list, session-delete, logout, and provider inputs", async () => {
    const received: Array<{ method: string; params: unknown }> = [];
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            sessionCapabilities: { list: {}, delete: {} },
            auth: { logout: {} },
            providers: {},
          },
        };
      },
      async newSession() {
        return { sessionId: "management-session" };
      },
      async listSessions(params) {
        received.push({ method: "session/list", params });
        return {
          sessions: [{
            sessionId: "listed-session",
            cwd: "/tmp/openma",
            title: "Listed",
          }],
        };
      },
      async deleteSession(params) {
        received.push({ method: "session/delete", params });
        return {};
      },
      async logout(params) {
        received.push({ method: "logout", params });
        return {};
      },
      async unstable_listProviders(params) {
        received.push({ method: "providers/list", params });
        return { providers: [] };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "management-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });
    const runtime = session as AcpSessionImpl & {
      supportsSessionList?: boolean;
      supportsSessionDelete?: boolean;
      supportsLogout?: boolean;
      supportsProviders?: boolean;
      listSessions?: (params: { cwd?: string }) => Promise<unknown>;
      deleteSession?: (sessionId: string) => Promise<void>;
      logout?: () => Promise<void>;
      listProviders?: () => Promise<unknown>;
    };

    await session.init();
    const listed = await runtime.listSessions?.({ cwd: "/tmp/openma" });
    await runtime.deleteSession?.("listed-session");
    await runtime.logout?.();
    const providers = await runtime.listProviders?.();
    const capabilities = {
      list: runtime.supportsSessionList,
      delete: runtime.supportsSessionDelete,
      logout: runtime.supportsLogout,
      providers: runtime.supportsProviders,
    };
    await session.dispose();

    expect(capabilities).toEqual({
      list: true,
      delete: true,
      logout: true,
      providers: true,
    });
    expect(listed).toEqual({
      sessions: [{
        sessionId: "listed-session",
        cwd: "/tmp/openma",
        title: "Listed",
      }],
    });
    expect(providers).toEqual({ providers: [] });
    expect(received).toEqual([
      { method: "session/list", params: { cwd: "/tmp/openma" } },
      { method: "session/delete", params: { sessionId: "listed-session" } },
      { method: "logout", params: {} },
      { method: "providers/list", params: {} },
    ]);
  });

  it("sends client-to-agent extension requests and notifications through the shared runtime", async () => {
    const received: Array<{ method: string; params: unknown }> = [];
    const harness = createHarness(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "extension-egress-session" };
      },
      async extMethod(method, params) {
        received.push({ method, params });
        return { accepted: true, method };
      },
      async extNotification(method, params) {
        received.push({ method, params });
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "extension-egress-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });
    const runtime = session as AcpSessionImpl & {
      requestExtension?: (
        method: string,
        params: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>;
      notifyExtension?: (
        method: string,
        params: Record<string, unknown>,
      ) => Promise<void>;
    };

    await session.init();
    const response = await runtime.requestExtension?.("_vendor.dev/control", {
      sessionId: "extension-egress-session",
      action: "pause",
    });
    await runtime.notifyExtension?.("_vendor.dev/observed", {
      sessionId: "extension-egress-session",
      revision: 2,
    });
    await session.dispose();

    expect(response).toEqual({ accepted: true, method: "_vendor.dev/control" });
    expect(received).toEqual([
      {
        method: "_vendor.dev/control",
        params: { sessionId: "extension-egress-session", action: "pause" },
      },
      {
        method: "_vendor.dev/observed",
        params: { sessionId: "extension-egress-session", revision: 2 },
      },
    ]);
  });

  it("advertises and delegates ACP elicitation only when the host supplies its callback lifecycle", async () => {
    let initializeRequest: { clientCapabilities?: Record<string, unknown> } | undefined;
    let elicitationResponse: unknown;
    const completed: unknown[] = [];
    const harness = createHarness((conn) => ({
      async initialize(params) {
        initializeRequest = params as typeof initializeRequest;
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "elicitation-session" };
      },
      async prompt() {
        elicitationResponse = await conn.unstable_createElicitation({
          mode: "url",
          sessionId: "elicitation-session",
          message: "Authorize repository access",
          elicitationId: "release-channel",
          url: "https://agent.example.com/connect",
        });
        await conn.unstable_completeElicitation({ elicitationId: "release-channel" });
        await conn.unstable_completeElicitation({ elicitationId: "release-channel" });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "elicitation-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        clientCallbacks: {
          createElicitation: async () => ({ action: "accept" }),
          completeElicitation: async (params) => {
            completed.push(params);
          },
        },
      },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("configure release")) events.push(event);
    await session.dispose();

    expect(initializeRequest?.clientCapabilities).toMatchObject({
      elicitation: { form: {}, url: {} },
    });
    expect(elicitationResponse).toEqual({ action: "accept" });
    expect(completed).toEqual([{ elicitationId: "release-channel" }]);
    expect(events).toContainEqual({
      type: "acp.elicitation_complete",
      method: "elicitation/complete",
      params: { elicitationId: "release-channel" },
    });
    expect(events).toContainEqual({
      type: "acp.client_notification",
      method: "elicitation/complete",
      params: { elicitationId: "release-channel" },
    });
    expect(events.filter((event) =>
      (event as { type?: string }).type === "acp.elicitation_complete",
    )).toHaveLength(1);
  });

  it("advertises URL elicitation from explicit host mode support without requiring a completion callback", async () => {
    let initializeRequest: { clientCapabilities?: Record<string, unknown> } | undefined;
    let elicitationResponse: unknown;
    const harness = createHarness((conn) => ({
      async initialize(params) {
        initializeRequest = params as typeof initializeRequest;
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "url-elicitation-session" };
      },
      async prompt() {
        elicitationResponse = await conn.unstable_createElicitation({
          mode: "url",
          sessionId: "url-elicitation-session",
          message: "Authorize repository access",
          elicitationId: "url-without-host-callback",
          url: "https://agent.example.com/connect",
        });
        await conn.unstable_completeElicitation({
          elicitationId: "url-without-host-callback",
        });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "url-elicitation-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        clientElicitationCapabilities: { url: {} },
        clientCallbacks: {
          createElicitation: async () => ({ action: "accept" }),
        },
      },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("authorize")) events.push(event);
    await session.dispose();

    expect(initializeRequest?.clientCapabilities).toMatchObject({
      elicitation: { url: {} },
    });
    expect(initializeRequest?.clientCapabilities).not.toMatchObject({
      elicitation: { form: {} },
    });
    expect(elicitationResponse).toEqual({ action: "accept" });
    expect(events).toContainEqual({
      type: "acp.elicitation_complete",
      method: "elicitation/complete",
      params: { elicitationId: "url-without-host-callback" },
    });
  });

  it("ignores elicitation completion for an unknown URL interaction", async () => {
    const completed: unknown[] = [];
    const harness = createHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "unknown-url-completion-session" };
      },
      async prompt() {
        await conn.unstable_completeElicitation({ elicitationId: "unknown-url" });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "unknown-url-completion-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        clientElicitationCapabilities: { url: {} },
        clientCallbacks: {
          createElicitation: async () => ({ action: "accept" }),
          completeElicitation: async (params) => {
            completed.push(params);
          },
        },
      },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("wait for oauth")) events.push(event);
    await session.dispose();

    expect(completed).toEqual([]);
    expect(events).not.toContainEqual({
      type: "acp.elicitation_complete",
      method: "elicitation/complete",
      params: { elicitationId: "unknown-url" },
    });
  });

  it("routes ACP-over-MCP requests and notifications through typed host callbacks", async () => {
    const received: Array<{ method: string; params: unknown }> = [];
    let listed: unknown;
    const harness = createHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "mcp-over-acp-session" };
      },
      async prompt() {
        const connected = await conn.extMethod("mcp/connect", {
          serverId: "openma-tools",
        });
        const connectionId = String(connected.connectionId);
        listed = await conn.extMethod("mcp/message", {
          connectionId,
          method: "tools/list",
        });
        await conn.extNotification("mcp/message", {
          connectionId,
          method: "notifications/initialized",
        });
        await conn.extMethod("mcp/disconnect", { connectionId });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "mcp-over-acp-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        mcpServers: [{
          type: "acp",
          name: "OpenMA tools",
          serverId: "openma-tools",
        }],
        clientCallbacks: {
          connectMcp: async (params) => {
            received.push({ method: "mcp/connect", params });
            return { connectionId: "mcp-connection-1" };
          },
          messageMcp: async (params) => {
            received.push({ method: "mcp/message:request", params });
            return { tools: [{ name: "inspect" }] };
          },
          notifyMcp: async (params) => {
            received.push({ method: "mcp/message:notification", params });
          },
          disconnectMcp: async (params) => {
            received.push({ method: "mcp/disconnect", params });
            return {};
          },
        },
      },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("list tools")) events.push(event);
    await session.dispose();

    expect(listed).toEqual({ tools: [{ name: "inspect" }] });
    expect(received).toEqual([
      { method: "mcp/connect", params: { serverId: "openma-tools" } },
      {
        method: "mcp/message:request",
        params: { connectionId: "mcp-connection-1", method: "tools/list" },
      },
      {
        method: "mcp/message:notification",
        params: {
          connectionId: "mcp-connection-1",
          method: "notifications/initialized",
        },
      },
      {
        method: "mcp/disconnect",
        params: { connectionId: "mcp-connection-1" },
      },
    ]);
    expect(events).toContainEqual({
      type: "acp.mcp_notification",
      method: "mcp/message",
      params: {
        connectionId: "mcp-connection-1",
        method: "notifications/initialized",
      },
    });
    expect(events).toContainEqual({
      type: "acp.client_notification",
      method: "mcp/message",
      params: {
        connectionId: "mcp-connection-1",
        method: "notifications/initialized",
      },
    });
  });

  it("negotiates and sends the complete ACP NES and document-input lifecycle", async () => {
    let initializeRequest: { clientCapabilities?: Record<string, unknown> } | undefined;
    const received: Array<{ method: string; params: unknown }> = [];
    const harness = createHarness(() => ({
      async initialize(params) {
        initializeRequest = params as typeof initializeRequest;
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            nes: {
              events: {
                document: {
                  didOpen: {},
                  didChange: { syncKind: "full" },
                  didClose: {},
                  didSave: {},
                  didFocus: {},
                },
              },
            },
            positionEncoding: "utf-16",
          },
        };
      },
      async newSession() {
        return { sessionId: "conversation-session" };
      },
      async unstable_startNes(params) {
        received.push({ method: "nes/start", params });
        return { sessionId: "nes-session" };
      },
      async unstable_suggestNes(params) {
        received.push({ method: "nes/suggest", params });
        return { suggestions: [] };
      },
      async unstable_closeNes(params) {
        received.push({ method: "nes/close", params });
        return {};
      },
      async unstable_didOpenDocument(params) {
        received.push({ method: "document/didOpen", params });
      },
      async unstable_didChangeDocument(params) {
        received.push({ method: "document/didChange", params });
      },
      async unstable_didCloseDocument(params) {
        received.push({ method: "document/didClose", params });
      },
      async unstable_didSaveDocument(params) {
        received.push({ method: "document/didSave", params });
      },
      async unstable_didFocusDocument(params) {
        received.push({ method: "document/didFocus", params });
      },
      async unstable_acceptNes(params) {
        received.push({ method: "nes/accept", params });
      },
      async unstable_rejectNes(params) {
        received.push({ method: "nes/reject", params });
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "nes-runtime-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        clientNesCapabilities: {
          jump: {},
          rename: {},
          searchAndReplace: {},
        },
        positionEncodings: ["utf-16"],
      },
    });

    await session.init();
    const started = await session.startNes({
      workspaceUri: "file:///tmp/openma",
      workspaceFolders: [{ uri: "file:///tmp/openma", name: "openma" }],
    });
    const document = {
      sessionId: started.sessionId,
      uri: "file:///tmp/openma/app.ts",
    };
    await session.didOpenDocument({
      ...document,
      languageId: "typescript",
      version: 1,
      text: "const answer = 41;\n",
    });
    await session.didChangeDocument({
      ...document,
      version: 2,
      contentChanges: [{ text: "const answer = 42;\n" }],
    });
    await session.didFocusDocument({
      ...document,
      version: 2,
      position: { line: 0, character: 18 },
      visibleRange: {
        start: { line: 0, character: 0 },
        end: { line: 1, character: 0 },
      },
    });
    const suggestions = await session.suggestNes({
      ...document,
      version: 2,
      position: { line: 0, character: 18 },
      triggerKind: "manual",
    });
    await session.acceptNes({ sessionId: started.sessionId, id: "suggestion-1" });
    await session.rejectNes({
      sessionId: started.sessionId,
      id: "suggestion-2",
      reason: "replaced",
    });
    await session.didSaveDocument(document);
    await session.didCloseDocument(document);
    await session.closeNes({ sessionId: started.sessionId });
    const capabilities = {
      supportsNes: session.supportsNes,
      nesCapabilities: session.nesCapabilities,
      positionEncoding: session.positionEncoding,
    };
    await session.dispose();

    expect(initializeRequest?.clientCapabilities).toMatchObject({
      nes: { jump: {}, rename: {}, searchAndReplace: {} },
      positionEncodings: ["utf-16"],
    });
    expect(capabilities).toEqual({
      supportsNes: true,
      nesCapabilities: {
        events: {
          document: {
            didOpen: {},
            didChange: { syncKind: "full" },
            didClose: {},
            didSave: {},
            didFocus: {},
          },
        },
      },
      positionEncoding: "utf-16",
    });
    expect(suggestions).toEqual({ suggestions: [] });
    expect(received.map(({ method }) => method)).toEqual([
      "nes/start",
      "document/didOpen",
      "document/didChange",
      "document/didFocus",
      "nes/suggest",
      "nes/accept",
      "nes/reject",
      "document/didSave",
      "document/didClose",
      "nes/close",
    ]);
  });

  it("sends structured content and returns a cancelled stop reason", async () => {
    let received: ContentBlock[] | undefined;
    let cancelCount = 0;
    const harness = createHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "session-1" };
      },
      async prompt(params) {
        received = params.prompt;
        await new Promise<void>((resolve) => {
          const timer = setInterval(() => {
            if (cancelCount > 0) {
              clearInterval(timer);
              resolve();
            }
          }, 1);
        });
        return { stopReason: "cancelled" };
      },
      async cancel() {
        cancelCount += 1;
      },
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "shared-acp-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });
    await session.init();
    const abort = new AbortController();
    const blocks: ContentBlock[] = [
      { type: "text", text: "hello" },
      { type: "resource_link", uri: "file:///tmp/readme.md", name: "readme" },
    ];
    const events: unknown[] = [];
    const draining = (async () => {
      for await (const event of session.prompt(blocks, { abortSignal: abort.signal })) {
        events.push(event);
      }
    })();
    await new Promise((resolve) => setTimeout(resolve, 5));
    abort.abort();
    await draining;
    await session.dispose();

    expect(received).toEqual(blocks);
    expect(cancelCount).toBe(1);
    expect(events).toContainEqual(expect.objectContaining({ type: "promptComplete" }));
  });
});

describe("legacy model catalog", () => {
  it("converts a legacy models catalog into a model select and leaves an existing model option alone", () => {
    const raw = {
      configOptions: [{
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select" as const,
        currentValue: "ask",
        options: [{ value: "ask", name: "Ask" }],
      }],
      models: {
        currentModelId: "future[medium]",
        availableModels: [
          { modelId: "known[medium]", name: "Known", description: "In the catalog" },
          { modelId: 3, name: "Skipped" },
          { modelId: "flash", name: "Flash" },
        ],
      },
    };

    const converted = sessionConfigOptionsFromResponse(raw);

    expect(converted).toEqual([
      raw.configOptions[0],
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "future[medium]",
        options: [
          { value: "known[medium]", name: "Known", description: "In the catalog" },
          { value: "flash", name: "Flash" },
        ],
        _meta: { "openma.dev/legacy-model-state": true },
      },
    ]);
    converted[0]!.name = "changed";
    expect(raw.configOptions[0]!.name).toBe("Mode");
    expect(sessionConfigOptionsFromResponse({
      configOptions: [{ id: "model", name: "Model", type: "select", currentValue: "a", options: [] }],
      models: raw.models,
    })).toHaveLength(1);
    expect(sessionConfigOptionsFromResponse({
      configOptions: [{ id: "effort", name: "Effort", category: "model", type: "select", currentValue: "low", options: [] }],
      models: raw.models,
    })).toHaveLength(1);
    expect(sessionConfigOptionsFromResponse({ models: { currentModelId: "x", availableModels: [] } })).toEqual([]);
    expect(sessionConfigOptionsFromResponse(null)).toEqual([]);
  });

  it("keeps the legacy catalog before the SDK drops unknown response fields", async () => {
    const models = {
      currentModelId: "future[medium]",
      availableModels: [{ modelId: "known[medium]", name: "Known" }],
    };
    const pair = makeStreamPair();
    const wire = ndJsonStream(pair.agentOutput, pair.agentInput);
    const reader = wire.readable.getReader();
    const writer = wire.writable.getWriter();
    const pump = (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const request = value as { id?: number; method?: string };
        if (request.id === undefined) continue;
        await writer.write({
          jsonrpc: "2.0",
          id: request.id,
          result: request.method === "initialize"
            ? { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} }
            : { sessionId: "legacy-models", models, configOptions: [] },
        });
      }
    })();
    const session = new AcpSessionImpl({
      child: pair.child,
      id: "legacy-models",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });
    try {
      await session.init();
      expect(session.legacyModels).toEqual(models);
      expect(session.configOptions).toEqual([]);
    } finally {
      await reader.cancel();
      await session.dispose();
      await pump.catch(() => undefined);
    }
  });
});

describe("client capability overlay", () => {
  it("deep-merges fs, session config options, auth meta, and top-level meta with the overlay winning", () => {
    expect(mergeClientCapabilities({
      fs: { readTextFile: false, writeTextFile: false, _meta: { base: true } },
      session: { configOptions: { boolean: {}, _meta: { base: true } } },
      auth: { terminal: false, _meta: { gateway: false, base: true } },
      _meta: { "subagent-transcript": true, terminal_output: true },
    }, {
      fs: { readTextFile: true, _meta: { overlay: true } },
      session: { configOptions: { _meta: { overlay: true } } },
      auth: { terminal: true, _meta: { gateway: true } },
      _meta: { "terminal-auth": true, parameterizedModelPicker: true, "subagent-transcript": false },
    })).toEqual({
      fs: { readTextFile: true, writeTextFile: false, _meta: { overlay: true } },
      session: {
        configOptions: {
          boolean: {},
          _meta: { overlay: true },
        },
      },
      auth: { terminal: true, _meta: { gateway: true, base: true } },
      _meta: {
        "subagent-transcript": false,
        terminal_output: true,
        "terminal-auth": true,
        parameterizedModelPicker: true,
      },
    });
  });

  it("leaves the built-in initialize capabilities unchanged when no overlay is set", async () => {
    let capabilities: unknown;
    const harness = createHarness((connection) => ({
      async initialize(params) {
        capabilities = params.clientCapabilities;
        void connection;
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "default-capabilities" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "default-capabilities",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });
    await session.init();
    await session.dispose();

    expect(capabilities).toMatchObject({
      session: { configOptions: { boolean: {} } },
      _meta: { "subagent-transcript": true, terminal_output: true },
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    });
    expect((capabilities as { _meta?: Record<string, unknown> })._meta?.parameterizedModelPicker).toBeUndefined();
    expect((capabilities as { _meta?: Record<string, unknown> })._meta?.["terminal-auth"]).toBeUndefined();
    expect((capabilities as { auth?: { terminal?: boolean } }).auth?.terminal).not.toBe(true);
  });

  it("sends the merged overlay on initialize", async () => {
    let capabilities: unknown;
    const harness = createHarness(() => ({
      async initialize(params) {
        capabilities = params.clientCapabilities;
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "overlay-capabilities" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "overlay-capabilities",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        clientCapabilityOverlay: {
          auth: { terminal: true, _meta: { gateway: true } },
          _meta: { "terminal-auth": true, parameterizedModelPicker: true },
          session: { configOptions: { _meta: { custom: true } } },
          fs: { readTextFile: true },
        },
      },
    });
    await session.init();
    await session.dispose();

    expect(capabilities).toMatchObject({
      auth: { terminal: true, _meta: { gateway: true } },
      fs: { readTextFile: true, writeTextFile: false },
      session: { configOptions: { boolean: {}, _meta: { custom: true } } },
      _meta: {
        "subagent-transcript": true,
        terminal_output: true,
        "terminal-auth": true,
        parameterizedModelPicker: true,
      },
    });
  });
});

describe("authentication-required session retry", () => {
  it("authenticates the first agent method once and retries session/new", async () => {
    const calls: string[] = [];
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          authMethods: [
            { id: "term", name: "Terminal", type: "terminal" },
            { id: "login", name: "Login" },
          ],
        };
      },
      async newSession() {
        calls.push("new");
        if (calls.filter((call) => call === "new").length === 1) {
          throw new RequestError(-32000, "Authentication required");
        }
        return { sessionId: "retried-session" };
      },
      async authenticate(params) {
        calls.push(`authenticate:${params.methodId}`);
        return {};
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "auth-retry",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });
    await session.init();
    await session.dispose();

    expect(session.acpSessionId).toBe("retried-session");
    expect(calls).toEqual(["new", "authenticate:login", "new"]);
  });

  it("does not retry a -32000 error whose message is not authentication required", async () => {
    const calls: string[] = [];
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          authMethods: [{ id: "login", name: "Login", type: "agent" }],
        };
      },
      async newSession() {
        calls.push("new");
        throw new RequestError(-32000, "Session store is locked");
      },
      async authenticate() {
        calls.push("authenticate");
        return {};
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "not-auth",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });
    await expect(session.init()).rejects.toMatchObject({
      code: -32000,
      message: "Session store is locked",
    });
    expect(calls).toEqual(["new"]);
    await session.dispose();
  });

  it("stops after one authentication retry when session/new is still unauthorized", async () => {
    let newCount = 0;
    let authCount = 0;
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          authMethods: [{ id: "login", name: "Login", type: "agent" }],
        };
      },
      async newSession() {
        newCount += 1;
        throw new RequestError(-32000, "Authentication required: still signed out");
      },
      async authenticate() {
        authCount += 1;
        return {};
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "auth-retry-once",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });
    await expect(session.init()).rejects.toMatchObject({ code: -32000 });
    expect(newCount).toBe(2);
    expect(authCount).toBe(1);
    await session.dispose();
  });

  it("retries session/resume and session/load once before falling through", async () => {
    const calls: string[] = [];
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          authMethods: [{ id: "login", name: "Login", type: "agent" }],
          agentCapabilities: {
            loadSession: true,
            sessionCapabilities: { resume: {} },
          },
        };
      },
      async resumeSession() {
        calls.push("resume");
        if (calls.filter((call) => call === "resume").length === 1) {
          throw new RequestError(-32000, "Authentication required");
        }
        return { configOptions: [] };
      },
      async loadSession() {
        calls.push("load");
        return {};
      },
      async newSession() {
        calls.push("new");
        return { sessionId: "unused" };
      },
      async authenticate() {
        calls.push("authenticate");
        return {};
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "auth-retry-resume",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        resumeAcpSessionId: "existing",
      },
    });
    await session.init();
    await session.dispose();
    expect(session.acpSessionId).toBe("existing");
    expect(calls).toEqual(["resume", "authenticate", "resume"]);
  });

  it("retries session/load once when resume is unavailable", async () => {
    const calls: string[] = [];
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          authMethods: [{ id: "login", name: "Login", type: "agent" }],
          agentCapabilities: { loadSession: true },
        };
      },
      async loadSession() {
        calls.push("load");
        if (calls.filter((call) => call === "load").length === 1) {
          throw new RequestError(-32000, "Authentication required");
        }
        return { configOptions: [] };
      },
      async newSession() {
        calls.push("new");
        return { sessionId: "fallback" };
      },
      async authenticate() {
        calls.push("authenticate");
        return {};
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "auth-retry-load",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        resumeAcpSessionId: "existing",
      },
    });
    await session.init();
    await session.dispose();
    expect(session.acpSessionId).toBe("existing");
    expect(calls).toEqual(["load", "authenticate", "load"]);
  });

  it("does not authenticate while forking an auth-required session", async () => {
    const calls: string[] = [];
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          authMethods: [{ id: "login", name: "Login", type: "agent" }],
          agentCapabilities: { sessionCapabilities: { fork: {} } },
        };
      },
      async unstable_forkSession() {
        calls.push("fork");
        throw new RequestError(-32000, "Authentication required");
      },
      async newSession() {
        calls.push("new");
        return { sessionId: "should-not-run" };
      },
      async authenticate() {
        calls.push("authenticate");
        return {};
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "auth-retry-fork",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        forkFromAcpSessionId: "source",
      },
    });
    await expect(session.init()).rejects.toMatchObject({ code: -32000 });
    expect(calls).toEqual(["fork"]);
    await session.dispose();
  });
});

describe("prompt timeout and dispose", () => {
  it("ends the prompt iterator when the agent ignores session/cancel", async () => {
    let cancelCount = 0;
    const harness = createHarness(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "timeout-session" };
      },
      async prompt() {
        return new Promise(() => undefined);
      },
      async cancel() {
        cancelCount += 1;
      },
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "timeout-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        perTurnTimeoutMs: 30,
      },
    });
    await session.init();
    const events: unknown[] = [];
    const started = Date.now();
    for await (const event of session.prompt("hello")) events.push(event);
    expect(Date.now() - started).toBeLessThan(1_000);
    await vi.waitFor(() => {
      expect(cancelCount).toBe(1);
    });
    expect(events).toEqual([{
      type: "promptError",
      error: "Error: ACP prompt timed out after 30ms",
      errorDetails: { message: "ACP prompt timed out after 30ms" },
    }]);
    await session.dispose();
  });

  it("shares one in-flight dispose promise until session/close and kill finish", async () => {
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    let releaseKill!: () => void;
    const killGate = new Promise<void>((resolve) => {
      releaseKill = resolve;
    });
    let killStarted!: () => void;
    const killStartedGate = new Promise<void>((resolve) => {
      killStarted = resolve;
    });
    const order: string[] = [];
    const kill = vi.fn(async () => {
      order.push("kill");
      killStarted();
      await killGate;
    });
    const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
    const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
    new AgentSideConnection(
      () => ({
        async initialize() {
          return {
            protocolVersion: PROTOCOL_VERSION,
            agentCapabilities: { sessionCapabilities: { close: {} } },
          };
        },
        async newSession() {
          return { sessionId: "dispose-session" };
        },
        async closeSession() {
          order.push("close");
          await closeGate;
          return {};
        },
        async prompt() {
          return { stopReason: "end_turn" };
        },
        async cancel() {},
        async authenticate() {
          return {};
        },
      }),
      ndJsonStream(agentToClient.writable, clientToAgent.readable),
    );
    const session = new AcpSessionImpl({
      id: "dispose-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
      child: {
        stdin: clientToAgent.writable,
        stdout: agentToClient.readable,
        stderr: new ReadableStream({ start(controller) { controller.close(); } }),
        exited: Promise.resolve({ code: 0, signal: null }),
        kill,
      },
    });
    await session.init();

    const first = session.dispose();
    const second = session.dispose();
    await vi.waitFor(() => {
      expect(order).toEqual(["close"]);
    });
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });
    releaseClose();
    await killStartedGate;
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    expect(kill).toHaveBeenCalledOnce();
    releaseKill();
    await Promise.all([first, second]);
    expect(secondSettled).toBe(true);
    expect(order).toEqual(["close", "kill"]);
    await session.dispose();
    expect(kill).toHaveBeenCalledOnce();
  });
});

describe("forkPoint session start", () => {
  it("sends session/fork with jetbrains.air.fork merged into the caller meta", async () => {
    let forkRequest: { _meta?: Record<string, unknown> | null } | undefined;
    let newSessionCalled = false;
    const sessionRequestMeta = {
      claudeCode: { parentToolUseId: "task-1" },
      jetbrains: { air: { note: "keep", fork: { version: 1, messageId: "stale", trace: "caller" } } },
    };
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentInfo: { name: "fake-inclusive-fork", version: "0.0.1" },
          agentCapabilities: {
            sessionCapabilities: { fork: {} },
            _meta: { jetbrains: { air: { fork: { version: 1, inclusive: true } } } },
          },
        };
      },
      async unstable_forkSession(params) {
        forkRequest = params;
        return { sessionId: "forked-message" };
      },
      async newSession() {
        newSessionCalled = true;
        return { sessionId: "should-not-run" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "fork-point-supported",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        forkFromAcpSessionId: "parent-session",
        forkPoint: {
          messageId: "answer-1",
          messageText: "abc",
          messageOccurrence: 2,
        },
        sessionRequestMeta,
      },
    });
    await session.init();
    await session.dispose();

    expect(newSessionCalled).toBe(false);
    expect(session.supportsSessionFork).toBe(true);
    expect(session.forkSupport).toEqual(forkSupport(session));
    expect(session.forkSupport).toMatchObject({
      level: "message",
      reason: "message-fork-advertised",
      messageFork: { version: 1, inclusive: true, source: "capability" },
    });
    expect(forkRequest?._meta).toEqual({
      claudeCode: { parentToolUseId: "task-1" },
      jetbrains: {
        air: {
          note: "keep",
          fork: {
            version: 1,
            messageId: "answer-1",
            messageOccurrence: 2,
            messageFingerprint: "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            trace: "caller",
          },
        },
      },
    });
    expect(sessionRequestMeta.jetbrains.air.fork.messageId).toBe("stale");
    expect(acpForkRequestMeta({
      messageId: "answer-1",
      messageText: "abc",
      messageOccurrence: 2,
    }).jetbrains).toBeTruthy();
  });

  it("sends a message fork for a verified adapter that does not advertise the capability key", async () => {
    let forkCalled = false;
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentInfo: { name: "codex-acp", version: "1.10.0" },
          agentCapabilities: { sessionCapabilities: { fork: {} } },
        };
      },
      async unstable_forkSession() {
        forkCalled = true;
        return { sessionId: "forked-verified" };
      },
      async newSession() {
        return { sessionId: "should-not-run" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "fork-point-verified",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        forkFromAcpSessionId: "parent-session",
        forkPoint: { messageId: "m", messageText: "abc", messageOccurrence: 1 },
      },
    });
    await session.init();
    expect(forkCalled).toBe(true);
    expect(session.forkSupport.reason).toBe("message-fork-verified-adapter");
    await session.dispose();
  });

  it("refuses a message fork point without sending session/fork", async () => {
    let forkCalled = false;
    let newSessionCalled = false;
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: { sessionCapabilities: { fork: {} } },
        };
      },
      async unstable_forkSession() {
        forkCalled = true;
        return { sessionId: "should-not-fork" };
      },
      async newSession() {
        newSessionCalled = true;
        return { sessionId: "should-not-run" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "fork-point-unsupported",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        forkFromAcpSessionId: "parent-session",
        forkPoint: { messageId: "m", messageText: "abc", messageOccurrence: 1 },
      },
    });
    await expect(session.init()).rejects.toThrow(
      "ACP agent does not support message-level fork (message-fork-not-advertised): This agent can fork the whole session but not from a specific message.",
    );
    expect(forkCalled).toBe(false);
    expect(newSessionCalled).toBe(false);
    await session.dispose();
  });

  it("refuses a caller-supplied jetbrains.air.fork when message fork is not supported", async () => {
    let forkCalled = false;
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentInfo: { name: "codex-acp", version: "1.9.9" },
          agentCapabilities: { sessionCapabilities: { fork: {} } },
        };
      },
      async unstable_forkSession() {
        forkCalled = true;
        return { sessionId: "should-not-fork" };
      },
      async newSession() {
        return { sessionId: "should-not-run" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "fork-meta-unsupported",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        forkFromAcpSessionId: "parent-session",
        sessionRequestMeta: {
          claudeCode: { parentToolUseId: "task-1" },
          jetbrains: { air: { fork: { version: 1, messageId: "m" } } },
        },
      },
    });
    await expect(session.init()).rejects.toThrow(/message-fork-not-advertised/);
    expect(forkCalled).toBe(false);
    await session.dispose();
  });

  it("rejects forkPoint when forkFromAcpSessionId is absent", async () => {
    let initialized = false;
    let forkCalled = false;
    const harness = createHarness(() => ({
      async initialize() {
        initialized = true;
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            sessionCapabilities: { fork: {} },
            _meta: { jetbrains: { air: { fork: { version: 1, inclusive: true } } } },
          },
        };
      },
      async unstable_forkSession() {
        forkCalled = true;
        return { sessionId: "should-not-fork" };
      },
      async newSession() {
        return { sessionId: "should-not-run" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "fork-point-without-parent",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        forkPoint: { messageId: "m", messageText: "abc", messageOccurrence: 1 },
      },
    });
    await expect(session.init()).rejects.toThrow(
      "forkPoint can only be used together with forkFromAcpSessionId",
    );
    expect(initialized).toBe(false);
    expect(forkCalled).toBe(false);
    await session.dispose();
  });
});

describe("acpForkRequestMeta", () => {
  it("builds jetbrains.air.fork v1 with a sha256 fingerprint of the UTF-8 text", () => {
    expect(acpForkRequestMeta({
      messageId: "answer-old",
      messageText: "abc",
      messageOccurrence: 2,
    })).toEqual({
      jetbrains: {
        air: {
          fork: {
            version: 1,
            messageId: "answer-old",
            messageOccurrence: 2,
            messageFingerprint: "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
          },
        },
      },
    });
  });
});

function makeStreamPair(): {
  child: ChildHandle;
  agentInput: ReadableStream<Uint8Array>;
  agentOutput: WritableStream<Uint8Array>;
} {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
  return {
    child: {
      stdin: clientToAgent.writable,
      stdout: agentToClient.readable,
      stderr: new ReadableStream({ start(controller) { controller.close(); } }),
      exited: Promise.resolve({ code: 0, signal: null }),
      async kill() {
        await Promise.allSettled([
          clientToAgent.writable.close(),
          agentToClient.writable.close(),
        ]);
      },
    },
    agentInput: clientToAgent.readable,
    agentOutput: agentToClient.writable,
  };
}

function createHarness(toAgent: (conn: AgentSideConnection) => Agent): { child: ChildHandle } {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
  new AgentSideConnection(
    toAgent,
    ndJsonStream(agentToClient.writable, clientToAgent.readable),
  );
  return {
    child: {
      stdin: clientToAgent.writable,
      stdout: agentToClient.readable,
      stderr: new ReadableStream({ start(controller) { controller.close(); } }),
      exited: Promise.resolve({ code: 0, signal: null }),
      async kill() {
        await Promise.allSettled([
          clientToAgent.writable.close(),
          agentToClient.writable.close(),
        ]);
      },
    },
  };
}
