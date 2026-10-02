import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type Agent,
  type AuthenticateRequest,
  type InitializeRequest,
  type InitializeResponse,
  type NewSessionResponse,
} from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authenticateAgent,
  disposeAllAcpProbes,
  probeAgentAuthStatus,
} from "../src/acp-runtime/probe.js";
import type { ChildHandle, Spawner } from "../src/acp-runtime/types.js";

afterEach(async () => {
  await disposeAllAcpProbes();
});

describe("probeAgentAuthStatus", () => {
  it("reports every auth status and the supported method types", async () => {
    const needsAuth = await probeAgentAuthStatus({
      agent: { command: "fake-agent" },
      cwd: "/tmp/openma-auth-needs",
      spawner: connectProbeAgent(() => new AuthRequiredProbeAgent([])),
    });
    expect(needsAuth).toEqual({
      status: "needs-auth",
      methodId: "login",
      methodName: "Login",
      methods: [{ id: "login", name: "Login", type: "agent" }],
    });

    const configuredCalls: string[] = [];
    await expect(probeAgentAuthStatus({
      agent: { command: "fake-agent" },
      cwd: "/tmp/openma-auth-configured",
      spawner: connectProbeAgent(() => new ConfiguredProbeAgent(configuredCalls)),
    })).resolves.toEqual({
      status: "configured",
      methodId: "login",
      methodName: "Login",
      methods: [{ id: "login", name: "Login", type: "agent" }],
    });
    expect(configuredCalls).toEqual(["initialize", "newSession"]);

    await expect(probeAgentAuthStatus({
      agent: { command: "fake-agent" },
      cwd: "/tmp/openma-auth-none",
      spawner: connectProbeAgent(() => new NoAuthMethodsProbeAgent([])),
    })).resolves.toEqual({ status: "none" });

    await expect(probeAgentAuthStatus({
      agent: { command: "fake-agent" },
      cwd: "/tmp/openma-auth-unknown",
      spawner: connectProbeAgent(() => new UnsupportedAuthProbeAgent([])),
    })).resolves.toEqual({
      status: "unknown",
      message: "No supported ACP auth method is available. Unsupported methods: card.",
    });

    await expect(probeAgentAuthStatus({
      agent: { command: "fake-agent" },
      cwd: "/tmp/openma-auth-error",
      spawner: connectProbeAgent(() => new BrokenSessionProbeAgent([])),
    })).resolves.toMatchObject({
      status: "unknown",
      methodId: "login",
      message: "backend unavailable",
    });
  });

  it("reports terminal methods, including credential prompts, without opening a session when a required variable is missing", async () => {
    const calls: string[] = [];
    await expect(probeAgentAuthStatus({
      agent: { command: "qwen", args: ["--acp"], env: { BASE: "1" } },
      cwd: "/tmp/openma-auth-terminal",
      spawner: connectProbeAgent(() => new TerminalAuthProbeAgent(calls, {
        type: "terminal",
        id: "login",
        name: "Login",
        args: ["auth", "login"],
        env: { AUTH: "1" },
      })),
    })).resolves.toMatchObject({
      status: "needs-auth",
      methods: [{
        id: "login",
        name: "Login",
        type: "terminal",
        terminalLaunch: {
          label: "Login",
          command: "qwen",
          args: ["auth", "login"],
          env: { BASE: "1", AUTH: "1" },
          cwd: "/tmp/openma-auth-terminal",
        },
      }],
    });

    const credentialCalls: string[] = [];
    await expect(probeAgentAuthStatus({
      agent: { command: "fake-agent" },
      cwd: "/tmp/openma-auth-terminal-env",
      spawner: connectProbeAgent(() => new TerminalAuthProbeAgent(credentialCalls, {
        id: "openai",
        name: "Use OpenAI API key",
        description: "Requires setting the OPENAI_API_KEY environment variable",
        _meta: { type: "terminal", args: ["--auth-type=openai"] },
      })),
    })).resolves.toMatchObject({
      status: "needs-auth",
      message: "Missing credential variable: OPENAI_API_KEY.",
      methods: [{
        id: "openai",
        type: "env_var",
        vars: [{ name: "OPENAI_API_KEY", secret: true }],
      }],
    });
    expect(credentialCalls).toEqual(["initialize:terminal=true"]);
  });

  it("treats env_var methods as credential forms and skips session/new until the variable is present", async () => {
    const missing: string[] = [];
    await expect(probeAgentAuthStatus({
      agent: { command: "fake-agent" },
      cwd: "/tmp/openma-auth-env",
      spawner: connectProbeAgent(() => new EnvVarAuthProbeAgent(missing)),
    })).resolves.toMatchObject({
      status: "needs-auth",
      message: "Missing credential variable: OPENAI_API_KEY.",
      methods: [{
        id: "openai-key",
        type: "env_var",
        vars: [{ name: "OPENAI_API_KEY", label: "API key", secret: true }],
        link: "https://platform.openai.com/api-keys",
      }],
    });
    expect(missing).toEqual(["initialize"]);

    const present: string[] = [];
    await expect(probeAgentAuthStatus({
      agent: { command: "fake-agent" },
      env: { OPENAI_API_KEY: "present" },
      cwd: "/tmp/openma-auth-env-present",
      spawner: connectProbeAgent(() => new EnvVarAuthProbeAgent(present)),
    })).resolves.toMatchObject({ status: "needs-auth", methodId: "openai-key" });
    expect(present).toEqual(["initialize", "newSession"]);
  });

  it("maps api-key and gateway metadata onto field forms", async () => {
    await expect(probeAgentAuthStatus({
      agent: { command: "fake-agent" },
      cwd: "/tmp/openma-auth-api-key",
      spawner: connectProbeAgent(() => new ConventionAuthProbeAgent([], {
        id: "provider-login",
        name: "Provider key",
        _meta: { "api-key": { provider: "anthropic" } },
      })),
    })).resolves.toMatchObject({
      status: "needs-auth",
      methods: [{
        id: "provider-login",
        type: "agent",
        form: "fields",
        vars: [{ name: "api-key", label: "API key", secret: true }],
      }],
    });

    await expect(probeAgentAuthStatus({
      agent: { command: "fake-agent" },
      cwd: "/tmp/openma-auth-gateway",
      spawner: connectProbeAgent(() => new ConventionAuthProbeAgent([], {
        id: "custom-endpoint",
        name: "Custom endpoint",
        _meta: { gateway: { protocol: "openai" } },
      })),
    })).resolves.toMatchObject({
      status: "configured",
      methods: [{
        id: "custom-endpoint",
        type: "agent",
        form: "fields",
        vars: [
          { name: "baseUrl", label: "Base URL" },
          { name: "api-key", label: "API key", secret: true },
          { name: "providerName", label: "Provider", optional: true },
        ],
      }],
    });
  });

  it("reports needs-auth when stderr says the session was created without credentials", async () => {
    await expect(probeAgentAuthStatus({
      agent: { command: "fake-agent" },
      cwd: "/tmp/openma-auth-diagnostic",
      spawner: connectProbeAgent(
        () => new ConfiguredProbeAgent([]),
        ["\u001b[31mACP: Creating session without credentials - agent may not work\u001b[0m"],
      ),
    })).resolves.toMatchObject({
      status: "needs-auth",
      message: "Creating session without credentials - agent may not work",
    });

    await expect(probeAgentAuthStatus({
      agent: { command: "fake-agent" },
      cwd: "/tmp/openma-auth-diagnostic-alt",
      spawner: connectProbeAgent(
        () => new ConfiguredProbeAgent([]),
        ["credentials missing and the agent may not work"],
      ),
    })).resolves.toMatchObject({
      status: "needs-auth",
      message: "credentials missing and the agent may not work",
    });
  });
});

describe("authenticateAgent", () => {
  it("completes api-key and gateway authentication from submitted values", async () => {
    const apiKey = new ConventionAuthProbeAgent([], {
      id: "provider-login",
      name: "Provider key",
      _meta: { "api-key": { provider: "anthropic" } },
    });
    await expect(authenticateAgent({
      agent: { command: "fake-agent" },
      cwd: "/tmp/openma-auth-submit-key",
      methodId: "provider-login",
      values: { "api-key": " sk-ant-test " },
      spawner: connectProbeAgent(() => apiKey),
    })).resolves.toEqual({ status: "completed" });
    expect(apiKey.authenticateCalls).toEqual([{
      methodId: "provider-login",
      _meta: { "api-key": { apiKey: "sk-ant-test" } },
    }]);

    const gateway = new ConventionAuthProbeAgent([], {
      id: "custom-endpoint",
      name: "Custom endpoint",
      _meta: { gateway: { protocol: "openai" } },
    });
    await expect(authenticateAgent({
      agent: { command: "fake-agent" },
      cwd: "/tmp/openma-auth-submit-gateway",
      values: {
        baseUrl: " https://api.example.com/v1 ",
        "api-key": "TOKEN",
        providerName: "custom",
      },
      spawner: connectProbeAgent(() => gateway),
    })).resolves.toEqual({ status: "completed" });
    expect(gateway.authenticateCalls).toEqual([{
      methodId: "custom-endpoint",
      _meta: {
        gateway: {
          baseUrl: "https://api.example.com/v1",
          headers: { Authorization: "Bearer TOKEN" },
          providerName: "custom",
        },
      },
    }]);
  });

  it("starts terminal auth, terminal-auth metadata, and createTerminal without calling a credential method", async () => {
    const launchInteractiveAuth = vi.fn(async () => undefined);
    const calls: string[] = [];
    await expect(authenticateAgent({
      agent: { command: "devin", args: ["acp"], env: { BASE: "1" } },
      cwd: "/tmp/openma-auth-terminal-start",
      env: { EXTRA: "2" },
      spawner: connectProbeAgent(() => new TerminalAuthProbeAgent(calls, {
        type: "terminal",
        id: "login",
        name: "Login",
        args: ["auth", "login"],
        env: { AUTH: "1" },
      })),
      launchInteractiveAuth,
    })).resolves.toEqual({ status: "started" });
    expect(launchInteractiveAuth).toHaveBeenCalledWith({
      label: "Login",
      command: "devin",
      args: ["auth", "login"],
      env: { BASE: "1", EXTRA: "2", AUTH: "1" },
      cwd: "/tmp/openma-auth-terminal-start",
    });
    expect(calls).toEqual(["initialize:terminal=true"]);

    const metaLaunch = vi.fn(async () => undefined);
    await expect(authenticateAgent({
      agent: { command: "gemini" },
      cwd: "/tmp/openma-auth-meta",
      spawner: connectProbeAgent(() => new TerminalAuthProbeAgent([], {
        id: "login",
        name: "Login",
        _meta: {
          "terminal-auth": {
            label: "gemini /auth",
            command: "gemini",
            args: ["/auth"],
            env: { SURFACE: "zed" },
          },
        },
      })),
      launchInteractiveAuth: metaLaunch,
    })).resolves.toEqual({ status: "started" });
    expect(metaLaunch).toHaveBeenCalledWith({
      label: "gemini /auth",
      command: "gemini",
      args: ["/auth"],
      env: { SURFACE: "zed" },
      cwd: "/tmp/openma-auth-meta",
    });

    const created: string[] = [];
    const createLaunch = vi.fn(async () => undefined);
    await expect(authenticateAgent({
      agent: { command: "devin" },
      cwd: "/tmp/openma-auth-create-terminal",
      spawner: connectProbeAgent((connection) => new TerminalCreateAuthProbeAgent(created, connection)),
      launchInteractiveAuth: createLaunch,
    })).resolves.toEqual({ status: "started" });
    expect(created).toContain("authenticate:login");
    expect(createLaunch).toHaveBeenCalledWith({
      label: "Login auth",
      command: "devin",
      args: ["auth", "login"],
      env: { DEVIN_AUTH: "1" },
      cwd: "/tmp/devin-auth",
    });

    await expect(authenticateAgent({
      agent: { command: "fake-agent" },
      cwd: "/tmp/openma-auth-env-reject",
      spawner: connectProbeAgent(() => new EnvVarAuthProbeAgent([])),
      launchInteractiveAuth,
    })).rejects.toThrow("requires credential variables (OPENAI_API_KEY)");
  });

  it("returns started after the grace period and kills the child when the background timeout elapses", async () => {
    const calls: string[] = [];
    const kill = vi.fn(async () => undefined);
    const delegate = connectProbeAgent(() => new BrowserHostedAuthProbeAgent(calls, 80));
    const spawner: Spawner = {
      async spawn(spec) {
        return { ...await delegate.spawn(spec), kill };
      },
    };

    await expect(authenticateAgent({
      agent: { command: "browser-auth-agent" },
      cwd: "/tmp/openma-auth-grace",
      spawner,
      agentAuthLaunchGraceMs: 5,
      backgroundAuthTimeoutMs: 30,
    })).resolves.toEqual({ status: "started" });
    expect(calls).toContain("authenticate:login");
    await vi.waitFor(() => {
      expect(kill).toHaveBeenCalled();
    });
  });

  it("lets shutdown dispose a background auth child before the background timeout", async () => {
    const kill = vi.fn(async () => undefined);
    const delegate = connectProbeAgent(() => new BrowserHostedAuthProbeAgent([], 200));
    const spawner: Spawner = {
      async spawn(spec) {
        return { ...await delegate.spawn(spec), kill };
      },
    };
    await expect(authenticateAgent({
      agent: { command: "browser-auth-agent" },
      cwd: "/tmp/openma-auth-shutdown",
      spawner,
      agentAuthLaunchGraceMs: 1,
      backgroundAuthTimeoutMs: 60_000,
    })).resolves.toEqual({ status: "started" });

    await disposeAllAcpProbes();
    expect(kill).toHaveBeenCalledOnce();
  });

  it("unwraps a generated shell shim when launching terminal auth", async () => {
    const launchInteractiveAuth = vi.fn(async () => undefined);
    const dir = await mkdtemp(join(tmpdir(), "openma-acp-shim-"));
    const shimPath = join(dir, "openma-acp-qwen");
    await writeFile(shimPath, [
      "#!/bin/sh",
      "set -eu",
      "exec '/registry/qwen' '--acp' \"$@\"",
      "",
    ].join("\n"), "utf8");
    try {
      await expect(authenticateAgent({
        agent: { command: shimPath, args: ["--acp"] },
        cwd: "/tmp/openma-auth-shim",
        spawner: connectProbeAgent(() => new TerminalAuthProbeAgent([], {
          id: "openai",
          name: "Use OpenAI API key",
          _meta: { type: "terminal", args: ["--auth-type=openai"] },
        })),
        launchInteractiveAuth,
      })).resolves.toEqual({ status: "started" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    expect(launchInteractiveAuth).toHaveBeenCalledWith({
      label: "Use OpenAI API key",
      command: "/registry/qwen",
      args: ["--auth-type=openai"],
      env: {},
      cwd: "/tmp/openma-auth-shim",
    });
  });

  it("surfaces authenticate error details", async () => {
    await expect(authenticateAgent({
      agent: { command: "qwen" },
      cwd: "/tmp/openma-auth-error-details",
      spawner: connectProbeAgent(() => new FailingAuthProbeAgent([])),
    })).rejects.toThrow("Missing API key for openai auth. Set OPENAI_API_KEY.");
  });
});

function connectProbeAgent(
  agentFactory: (connection: AgentSideConnection) => Agent,
  diagnostics: string[] = [],
): Spawner {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
  new AgentSideConnection(agentFactory, ndJsonStream(agentToClient.writable, clientToAgent.readable));
  const child: ChildHandle = {
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
  };
  return {
    async spawn(spec) {
      for (const line of diagnostics) spec.onDiagnosticLine?.(line);
      return child;
    },
  };
}

class AuthRequiredProbeAgent implements Agent {
  constructor(protected readonly calls: string[]) {}

  async initialize(_params?: InitializeRequest): Promise<InitializeResponse> {
    this.calls.push("initialize");
    return {
      protocolVersion: PROTOCOL_VERSION,
      authMethods: [{ id: "login", name: "Login" }],
      agentCapabilities: { promptCapabilities: {} },
    };
  }

  async newSession(): Promise<NewSessionResponse> {
    this.calls.push("newSession");
    throw RequestError.authRequired();
  }

  async authenticate(params: AuthenticateRequest): Promise<void> {
    this.calls.push(`authenticate:${params.methodId}`);
  }

  async prompt() {
    return { stopReason: "end_turn" as const };
  }

  async cancel() {
    return undefined;
  }
}

class ConfiguredProbeAgent extends AuthRequiredProbeAgent {
  override async newSession(): Promise<NewSessionResponse> {
    this.calls.push("newSession");
    return { sessionId: "configured-session" };
  }
}

class ConventionAuthProbeAgent extends AuthRequiredProbeAgent {
  readonly authenticateCalls: AuthenticateRequest[] = [];

  constructor(calls: string[], private readonly method: Record<string, unknown>) {
    super(calls);
  }

  override async initialize(params: InitializeRequest): Promise<InitializeResponse> {
    this.calls.push(`initialize:gateway=${Boolean(params.clientCapabilities?.auth?._meta?.gateway)}`);
    return {
      protocolVersion: PROTOCOL_VERSION,
      authMethods: [this.method as never],
      agentCapabilities: { promptCapabilities: {} },
    };
  }

  override async newSession(): Promise<NewSessionResponse> {
    this.calls.push("newSession");
    if ((this.method._meta as { gateway?: unknown } | undefined)?.gateway) {
      return { sessionId: "gateway-session" };
    }
    throw RequestError.authRequired();
  }

  override async authenticate(params: AuthenticateRequest): Promise<void> {
    this.authenticateCalls.push(params);
  }
}

class NoAuthMethodsProbeAgent implements Agent {
  constructor(protected readonly calls: string[]) {}

  async initialize(): Promise<InitializeResponse> {
    this.calls.push("initialize");
    return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: { promptCapabilities: {} } };
  }

  async newSession(): Promise<NewSessionResponse> {
    this.calls.push("newSession");
    return { sessionId: "should-not-create" };
  }

  async authenticate() {
    return {};
  }

  async prompt() {
    return { stopReason: "end_turn" as const };
  }

  async cancel() {
    return undefined;
  }
}

class UnsupportedAuthProbeAgent extends NoAuthMethodsProbeAgent {
  override async initialize(): Promise<InitializeResponse> {
    this.calls.push("initialize");
    return {
      protocolVersion: PROTOCOL_VERSION,
      authMethods: [{ id: "magic-card", name: "Magic Card", type: "card" } as never],
      agentCapabilities: { promptCapabilities: {} },
    };
  }
}

class BrokenSessionProbeAgent extends AuthRequiredProbeAgent {
  override async newSession(): Promise<NewSessionResponse> {
    this.calls.push("newSession");
    throw new RequestError(-32603, "Internal error", { details: "backend unavailable" });
  }
}

class TerminalAuthProbeAgent extends AuthRequiredProbeAgent {
  constructor(calls: string[], private readonly authMethod: Record<string, unknown>) {
    super(calls);
  }

  override async initialize(params: InitializeRequest): Promise<InitializeResponse> {
    this.calls.push(`initialize:terminal=${Boolean(params.clientCapabilities?.auth?.terminal)}`);
    return {
      protocolVersion: PROTOCOL_VERSION,
      authMethods: params.clientCapabilities?.auth?.terminal ? [this.authMethod as never] : [],
      agentCapabilities: { promptCapabilities: {} },
    };
  }
}

class EnvVarAuthProbeAgent extends AuthRequiredProbeAgent {
  override async initialize(): Promise<InitializeResponse> {
    this.calls.push("initialize");
    return {
      protocolVersion: PROTOCOL_VERSION,
      authMethods: [{
        type: "env_var",
        id: "openai-key",
        name: "OpenAI API key",
        description: "Use an OpenAI-compatible API key",
        vars: [{ name: "OPENAI_API_KEY", label: "API key", secret: true }],
        link: "https://platform.openai.com/api-keys",
      } as never],
      agentCapabilities: { promptCapabilities: {} },
    };
  }
}

class TerminalCreateAuthProbeAgent extends AuthRequiredProbeAgent {
  constructor(calls: string[], private readonly connection: AgentSideConnection) {
    super(calls);
  }

  override async authenticate(params: AuthenticateRequest): Promise<void> {
    this.calls.push(`authenticate:${params.methodId}`);
    const terminal = await this.connection.createTerminal({
      sessionId: "auth-session",
      command: "devin",
      args: ["auth", "login"],
      env: [{ name: "DEVIN_AUTH", value: "1" }],
      cwd: "/tmp/devin-auth",
    });
    this.calls.push(`terminal:${terminal.id}`);
    return new Promise(() => undefined);
  }
}

class BrowserHostedAuthProbeAgent extends AuthRequiredProbeAgent {
  constructor(calls: string[], private readonly rejectAfterMs: number) {
    super(calls);
  }

  override async authenticate(params: AuthenticateRequest): Promise<void> {
    this.calls.push(`authenticate:${params.methodId}`);
    await new Promise((resolve) => setTimeout(resolve, this.rejectAfterMs));
    throw new Error("Login canceled");
  }
}

class FailingAuthProbeAgent extends AuthRequiredProbeAgent {
  override async authenticate(params: AuthenticateRequest): Promise<void> {
    this.calls.push(`authenticate:${params.methodId}`);
    throw new RequestError(-32603, "Internal error", {
      details: "Missing API key for openai auth. Set OPENAI_API_KEY.",
    });
  }
}
