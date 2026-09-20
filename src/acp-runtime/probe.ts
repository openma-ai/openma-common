import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type AuthMethod,
  type Client,
  type ClientCapabilities,
  type SessionConfigOption,
  type SessionModeState,
} from "@agentclientprotocol/sdk";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeSpawner } from "./spawners/node.js";
import type { AgentSpec, Spawner } from "./types.js";

export interface ProbeAcpSessionOptions {
  agent: AgentSpec;
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Maximum time allowed for initialize, session/new, and capability updates. */
  timeoutMs?: number;
  /** Bounded grace period for post-session/new capability notifications. */
  capabilitySettleMs?: number;
  spawner?: Spawner;
}

export interface ProbeAcpSessionResult {
  sessionId: string;
  configOptions: SessionConfigOption[];
  availableCommands: unknown[];
  modes: SessionModeState | null;
  authMethods: AuthMethod[];
}

const ACP_CLIENT_CAPABILITIES: ClientCapabilities = {
  fs: { readTextFile: true, writeTextFile: true },
  terminal: true,
  auth: { terminal: true, _meta: { gateway: true } },
  _meta: { "terminal-auth": true, terminal_output: true },
} as ClientCapabilities;

/**
 * Disposable capability probe used during product cold start. It deliberately
 * never returns the child as a real session: callers must start a fresh ACP
 * session after consuming this snapshot.
 */
export async function probeAcpSession(
  options: ProbeAcpSessionOptions,
): Promise<ProbeAcpSessionResult> {
  const cwd = options.cwd ?? join(tmpdir(), "openma-acp-probe");
  await mkdir(cwd, { recursive: true });

  let configOptions: SessionConfigOption[] = [];
  let availableCommands: unknown[] = [];
  let currentModeId: string | undefined;
  let resolveCommands: (() => void) | undefined;
  const commandsReady = new Promise<void>((resolve) => {
    resolveCommands = resolve;
  });
  const client: Client = {
    sessionUpdate: async (params) => {
      const update = asRecord(params.update);
      if (!update) return;
      if (update.sessionUpdate === "config_option_update" && Array.isArray(update.configOptions)) {
        configOptions = update.configOptions.map((option) => structuredClone(option)) as SessionConfigOption[];
      }
      if (update.sessionUpdate === "available_commands_update") {
        const commands = Array.isArray(update.availableCommands)
          ? update.availableCommands
          : Array.isArray(update.available_commands)
            ? update.available_commands
            : undefined;
        if (commands) {
          availableCommands = commands.map((command) => structuredClone(command));
          resolveCommands?.();
        }
      }
      if (update.sessionUpdate === "current_mode_update" && typeof update.currentModeId === "string") {
        currentModeId = update.currentModeId;
      }
    },
    requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
  };

  const connection = await spawnProbeAgent({
    agent: options.agent,
    cwd,
    env: options.env,
    spawner: options.spawner,
    client,
  });
  const timeoutMs = Math.max(1, options.timeoutMs ?? 15_000);
  const settleMs = Math.max(0, options.capabilitySettleMs ?? 750);
  try {
    return await withTimeout((async () => {
      const initialized = await Promise.resolve(connection.agent.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: ACP_CLIENT_CAPABILITIES,
      }));
      const created = await Promise.resolve(connection.agent.newSession({
        cwd,
        mcpServers: [],
      }));
      await waitForSignalOrTimeout(commandsReady, settleMs);
      const responseOptions = Array.isArray(created.configOptions)
        ? created.configOptions.map((option) => structuredClone(option))
        : [];
      const responseModes = created.modes ? structuredClone(created.modes) : null;
      return {
        sessionId: created.sessionId,
        configOptions: responseOptions.length > 0 ? responseOptions : configOptions,
        availableCommands,
        modes: responseModes
          ? (currentModeId ? { ...responseModes, currentModeId } : responseModes)
          : null,
        authMethods: Array.isArray(initialized.authMethods)
          ? initialized.authMethods.map((method) => structuredClone(method))
          : [],
      };
    })(), timeoutMs, `ACP capability probe timed out after ${timeoutMs}ms`);
  } finally {
    await connection.dispose();
  }
}

const activeProbes = new Set<() => Promise<void>>();

/** Dispose every in-flight cold-start probe before a product shuts down. */
export async function disposeAllAcpProbes(): Promise<void> {
  await Promise.allSettled([...activeProbes].map((dispose) => dispose()));
}

async function spawnProbeAgent(options: {
  agent: AgentSpec;
  cwd: string;
  env?: Record<string, string | undefined>;
  spawner?: Spawner;
  client: Client;
}): Promise<{ agent: Agent; dispose: () => Promise<void> }> {
  const mergedEnv: Record<string, string | undefined> = {
    ...(options.agent.env ?? {}),
    ...(options.env ?? {}),
  };
  const child = await (options.spawner ?? new NodeSpawner()).spawn({
    ...options.agent,
    cwd: options.cwd,
    env: mergedEnv,
  });
  const stream = ndJsonStream(child.stdin, child.stdout);
  const agent = new ClientSideConnection(() => options.client, stream);
  let disposed: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    disposed ??= child.kill().catch(() => undefined).finally(() => {
      activeProbes.delete(dispose);
    });
    return disposed;
  };
  activeProbes.add(dispose);
  return { agent, dispose };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        if (typeof timer === "object" && "unref" in timer) timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function waitForSignalOrTimeout(signal: Promise<void>, timeoutMs: number): Promise<void> {
  if (timeoutMs === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      signal,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        if (typeof timer === "object" && "unref" in timer) timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
