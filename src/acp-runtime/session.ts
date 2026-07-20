import {
  ClientSideConnection,
  ndJsonStream,
  type Agent,
  type Client,
} from "@agentclientprotocol/sdk";
import type * as schema from "@agentclientprotocol/sdk";
import type { AcpSession, ChildHandle, ClientCallbacks, SessionOptions } from "./types.js";

export interface AcpSessionConstructOptions {
  child: ChildHandle;
  options: SessionOptions;
  id: string;
}

export class AcpSessionImpl implements AcpSession {
  readonly id: string;
  readonly options: SessionOptions;

  #child: ChildHandle;
  #agent!: Agent;
  #sessionId!: string;
  #disposed = false;
  #activePromptCount = 0;
  #pendingEvents: unknown[] = [];
  #waiters: Array<(value: IteratorResult<unknown>) => void> = [];
  #authMethods: readonly schema.AuthMethod[] = [];
  #agentInfo: schema.Implementation | null = null;
  #configOptions: readonly schema.SessionConfigOption[] = [];
  #promptCapabilities: schema.PromptCapabilities = {};
  #supportsSessionFork = false;

  constructor(deps: AcpSessionConstructOptions) {
    this.id = deps.id;
    this.options = deps.options;
    this.#child = deps.child;
  }

  get acpSessionId(): string {
    return this.#sessionId ?? "";
  }

  get authMethods(): readonly schema.AuthMethod[] {
    return this.#authMethods;
  }

  get agentInfo(): schema.Implementation | null {
    return this.#agentInfo;
  }

  get configOptions(): readonly schema.SessionConfigOption[] {
    return this.#configOptions;
  }

  get promptCapabilities(): schema.PromptCapabilities {
    return this.#promptCapabilities;
  }

  get supportsSessionFork(): boolean {
    return this.#supportsSessionFork;
  }

  async init(): Promise<void> {
    const initStartedAt = Date.now();
    const callbacks: ClientCallbacks = this.options.clientCallbacks ?? {};
    const connection = new ClientSideConnection(
      (): Client => this.#createClient(callbacks),
      ndJsonStream(this.#child.stdin, this.#child.stdout),
    );
    this.#agent = connection;

    const initialized = await this.#agent.initialize({
      protocolVersion: 1,
      clientCapabilities: {
        fs: {
          readTextFile: Boolean(callbacks.readTextFile),
          writeTextFile: Boolean(callbacks.writeTextFile),
        },
        terminal: Boolean(callbacks.createTerminal),
      },
    });
    const initializedAt = Date.now();

    this.#authMethods = initialized.authMethods ?? [];
    this.#agentInfo = initialized.agentInfo ?? null;
    this.#promptCapabilities = initialized.agentCapabilities?.promptCapabilities ?? {};
    this.#supportsSessionFork =
      initialized.agentCapabilities?.sessionCapabilities?.fork != null;

    const cwd = this.options.agent.cwd ?? process.cwd();
    const mcpServers = this.options.mcpServers ?? [];

    if (this.options.forkFromAcpSessionId) {
      if (!this.#supportsSessionFork || !this.#agent.unstable_forkSession) {
        throw new Error("ACP agent does not support unstable session/fork");
      }
      const forked = await this.#agent.unstable_forkSession({
        sessionId: this.options.forkFromAcpSessionId,
        cwd,
        mcpServers,
      });
      this.#sessionId = forked.sessionId;
      this.#configOptions = forked.configOptions ?? [];
      this.#logInit("fork", initStartedAt, initializedAt);
      return;
    }

    if (
      this.options.resumeAcpSessionId &&
      initialized.agentCapabilities?.loadSession === true &&
      this.#agent.loadSession
    ) {
      try {
        const loaded = await this.#agent.loadSession({
          sessionId: this.options.resumeAcpSessionId,
          cwd,
          mcpServers,
        });
        this.#sessionId = this.options.resumeAcpSessionId;
        this.#configOptions = loaded.configOptions ?? [];
        this.#logInit("load", initStartedAt, initializedAt);
        return;
      } catch (error) {
        console.error(
          `[acp] session/load(${this.options.resumeAcpSessionId}) failed, falling back to new:`,
          error,
        );
      }
    }

    const created = await this.#agent.newSession({ cwd, mcpServers });
    this.#sessionId = created.sessionId;
    this.#configOptions = created.configOptions ?? [];
    this.#logInit("new", initStartedAt, initializedAt);
  }

  #createClient(callbacks: ClientCallbacks): Client {
    return {
      sessionUpdate: async (params) => {
        const inner = (params as { update?: unknown }).update;
        const update = inner === undefined ? params : inner;
        if (this.#activePromptCount === 0 && !isIdleSessionUpdate(update)) return;
        this.#pushEvent(update);
      },
      requestPermission: async (params) => {
        if (!callbacks.requestPermission) {
          return { outcome: { outcome: "cancelled" } };
        }
        try {
          return await callbacks.requestPermission(params);
        } catch (error) {
          this.#pushEvent({ type: "requestPermissionError", error: String(error) });
          return { outcome: { outcome: "cancelled" } };
        }
      },
      readTextFile: callbacks.readTextFile
        ? async (params) => callbacks.readTextFile!(params)
        : undefined,
      writeTextFile: callbacks.writeTextFile
        ? async (params) => callbacks.writeTextFile!(params)
        : undefined,
      createTerminal: callbacks.createTerminal
        ? async (params) => callbacks.createTerminal!(params)
        : undefined,
      terminalOutput: callbacks.terminalOutput
        ? async (params) => callbacks.terminalOutput!(params)
        : undefined,
      releaseTerminal: callbacks.releaseTerminal
        ? async (params) => callbacks.releaseTerminal!(params)
        : undefined,
      waitForTerminalExit: callbacks.waitForTerminalExit
        ? async (params) => callbacks.waitForTerminalExit!(params)
        : undefined,
      killTerminal: callbacks.killTerminal
        ? async (params) => callbacks.killTerminal!(params)
        : undefined,
    };
  }

  #logInit(mode: "new" | "load" | "fork", startedAt: number, initializedAt: number): void {
    if (process.env.NODE_ENV === "test") return;
    const completedAt = Date.now();
    process.stderr.write(
      `[acp-init] id=${this.id} mode=${mode} initialize_ms=${initializedAt - startedAt} session_open_ms=${completedAt - initializedAt} total_ms=${completedAt - startedAt}\n`,
    );
  }

  async authenticate(methodId: string): Promise<void> {
    if (!this.#agent) throw new Error("AcpSession not initialized");
    await this.#agent.authenticate({ methodId });
  }

  async setMode(modeId: string): Promise<void> {
    if (!this.#agent || !this.#sessionId) throw new Error("AcpSession not initialized");
    const setSessionMode = (
      this.#agent as { setSessionMode?: (params: unknown) => Promise<unknown> }
    ).setSessionMode;
    if (typeof setSessionMode !== "function") return;
    try {
      await setSessionMode.call(this.#agent, { sessionId: this.#sessionId, modeId });
    } catch (error) {
      console.warn(`[acp] setSessionMode("${modeId}") failed:`, error);
    }
  }

  async setConfigOption(
    configId: string,
    value: string | boolean,
  ): Promise<readonly schema.SessionConfigOption[]> {
    if (!this.#agent || !this.#sessionId) throw new Error("AcpSession not initialized");
    const setSessionConfigOption = (
      this.#agent as {
        setSessionConfigOption?: (
          params: schema.SetSessionConfigOptionRequest,
        ) => Promise<schema.SetSessionConfigOptionResponse>;
      }
    ).setSessionConfigOption;
    if (typeof setSessionConfigOption !== "function") {
      throw new Error("ACP agent does not support session config options");
    }
    const response = await setSessionConfigOption.call(this.#agent, {
      sessionId: this.#sessionId,
      configId,
      ...(typeof value === "boolean" ? { type: "boolean" as const, value } : { value }),
    });
    this.#configOptions = response.configOptions ?? [];
    return this.#configOptions;
  }

  prompt(
    input: string | readonly schema.ContentBlock[],
    options?: { abortSignal?: AbortSignal },
  ): AsyncIterable<unknown> {
    if (this.#disposed) throw new Error(`AcpSession ${this.id} is disposed`);
    return this.#prompt(input, options);
  }

  async provideToolResult(toolCallId: string, result: unknown): Promise<void> {
    void toolCallId;
    void result;
    throw new Error("provideToolResult not implemented; ACP tools use client callbacks");
  }

  drainPendingEvents(): unknown[] {
    return this.#pendingEvents.splice(0);
  }

  async *#prompt(
    input: string | readonly schema.ContentBlock[],
    options?: { abortSignal?: AbortSignal },
  ): AsyncIterable<unknown> {
    const onAbort = () => {
      this.#agent.cancel({ sessionId: this.#sessionId }).catch(() => {});
    };
    options?.abortSignal?.addEventListener("abort", onAbort, { once: true });

    const turnAbort = new AbortController();
    const timer = this.options.perTurnTimeoutMs
      ? setTimeout(() => turnAbort.abort(), this.options.perTurnTimeoutMs)
      : undefined;
    options?.abortSignal?.addEventListener("abort", () => turnAbort.abort(), { once: true });
    turnAbort.signal.addEventListener("abort", onAbort, { once: true });

    this.#activePromptCount += 1;
    const prompt = typeof input === "string" ? [{ type: "text" as const, text: input }] : [...input];
    const done = this.#agent
      .prompt({ sessionId: this.#sessionId, prompt })
      .finally(() => {
        this.#activePromptCount = Math.max(0, this.#activePromptCount - 1);
        if (timer) clearTimeout(timer);
        options?.abortSignal?.removeEventListener("abort", onAbort);
      });

    let ended = false;
    void done.then(
      (response) => {
        ended = true;
        this.#pushEvent({ type: "promptComplete", response });
        this.#endStream();
      },
      (error) => {
        ended = true;
        this.#pushEvent({ type: "promptError", error: String(error) });
        this.#endStream();
      },
    );

    while (true) {
      if (this.#pendingEvents.length > 0) {
        yield this.#pendingEvents.shift();
      } else if (ended) {
        break;
      } else {
        await new Promise<void>((resolve) => {
          this.#waiters.push(() => resolve());
        });
      }
    }
    await done;
  }

  isAlive(): boolean {
    return !this.#disposed;
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#endStream();
    await this.#child.kill("SIGTERM").catch(() => {});
  }

  #pushEvent(event: unknown): void {
    this.#pendingEvents.push(event);
    this.#waiters.shift()?.({ value: undefined, done: false });
  }

  #endStream(): void {
    while (this.#waiters.length > 0) {
      this.#waiters.shift()?.({ value: undefined, done: true });
    }
  }
}

const IDLE_SESSION_UPDATES = new Set([
  "available_commands_update",
  "current_mode_update",
  "config_option_update",
  "session_info_update",
]);

function isIdleSessionUpdate(update: unknown): boolean {
  const tag = (update as { sessionUpdate?: unknown } | null)?.sessionUpdate;
  return typeof tag === "string" && IDLE_SESSION_UPDATES.has(tag);
}
