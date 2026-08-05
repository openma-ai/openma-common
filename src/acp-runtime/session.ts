import {
  ClientSideConnection,
  RequestError,
  ndJsonStream,
  type Agent,
  type Client,
} from "@agentclientprotocol/sdk";
import type * as schema from "@agentclientprotocol/sdk";
import { preserveAcpNotificationContext } from "../session-events/acp.js";
import type {
  AcpSession,
  ChildHandle,
  ClientCallbacks,
  SessionOptions,
  SteeringOutcome,
} from "./types.js";

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
  #acceptOutOfBandUpdates = false;
  #activePromptCount = 0;
  #pendingEvents: unknown[] = [];
  #waiters: Array<(value: IteratorResult<unknown>) => void> = [];
  #authMethods: readonly schema.AuthMethod[] = [];
  #protocolVersion: schema.ProtocolVersion | null = null;
  #agentInfo: schema.Implementation | null = null;
  #agentCapabilities: schema.AgentCapabilities = {};
  #initializeMeta: Record<string, unknown> | null = null;
  #sessionSetupMeta: Record<string, unknown> | null = null;
  #configOptions: readonly schema.SessionConfigOption[] = [];
  #modes: schema.SessionModeState | null = null;
  #promptCapabilities: schema.PromptCapabilities = {};
  #supportsSessionFork = false;
  #supportsSessionList = false;
  #supportsSessionDelete = false;
  #supportsSessionResume = false;
  #supportsSessionClose = false;
  #supportsAdditionalDirectories = false;
  #supportsLogout = false;
  #supportsProviders = false;
  #supportsNes = false;
  #nesCapabilities: schema.NesCapabilities | null = null;
  #positionEncoding: schema.PositionEncodingKind | null = null;
  #supportsSteering = false;
  #nextClientRequestId = 1;
  #outstandingUrlElicitations = new Set<string>();

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

  get protocolVersion(): schema.ProtocolVersion | null {
    return this.#protocolVersion;
  }

  get agentInfo(): schema.Implementation | null {
    return this.#agentInfo;
  }

  get agentCapabilities(): schema.AgentCapabilities {
    return this.#agentCapabilities;
  }

  get initializeMeta(): Record<string, unknown> | null {
    return this.#initializeMeta;
  }

  get sessionSetupMeta(): Record<string, unknown> | null {
    return this.#sessionSetupMeta;
  }

  get configOptions(): readonly schema.SessionConfigOption[] {
    return this.#configOptions;
  }

  get modes(): schema.SessionModeState | null {
    return this.#modes;
  }

  get promptCapabilities(): schema.PromptCapabilities {
    return this.#promptCapabilities;
  }

  get supportsSessionFork(): boolean {
    return this.#supportsSessionFork;
  }

  get supportsSessionList(): boolean {
    return this.#supportsSessionList;
  }

  get supportsSessionDelete(): boolean {
    return this.#supportsSessionDelete;
  }

  get supportsSessionResume(): boolean {
    return this.#supportsSessionResume;
  }

  get supportsSessionClose(): boolean {
    return this.#supportsSessionClose;
  }

  get supportsAdditionalDirectories(): boolean {
    return this.#supportsAdditionalDirectories;
  }

  get supportsLogout(): boolean {
    return this.#supportsLogout;
  }

  get supportsProviders(): boolean {
    return this.#supportsProviders;
  }

  get supportsNes(): boolean {
    return this.#supportsNes;
  }

  get nesCapabilities(): schema.NesCapabilities | null {
    return this.#nesCapabilities;
  }

  get positionEncoding(): schema.PositionEncodingKind | null {
    return this.#positionEncoding;
  }

  get supportsSteering(): boolean {
    return this.#supportsSteering;
  }

  async init(): Promise<void> {
    const initStartedAt = Date.now();
    const callbacks: ClientCallbacks = this.options.clientCallbacks ?? {};
    const requestedElicitationCapabilities =
      this.options.clientElicitationCapabilities
      ?? (callbacks.createElicitation
        ? {
            form: {},
            ...(callbacks.completeElicitation ? { url: {} } : {}),
          }
        : undefined);
    const elicitationCapabilities = callbacks.createElicitation
      && requestedElicitationCapabilities
      && (
        requestedElicitationCapabilities.form != null
        || requestedElicitationCapabilities.url != null
      )
      ? requestedElicitationCapabilities
      : undefined;
    const connection = new ClientSideConnection(
      (): Client => this.#createClient(
        callbacks,
        elicitationCapabilities?.url != null,
      ),
      ndJsonStream(this.#child.stdin, this.#child.stdout),
    );
    this.#agent = connection;

    const initialized = await this.#agent.initialize({
      protocolVersion: 1,
      clientCapabilities: {
        // The existing OpenMA controls render both boolean config options and
        // structured/markdown plans. Advertising these capabilities prevents
        // agents such as codex-acp from degrading them to plain transcript
        // text even though the canonical event and GUI projections exist.
        session: {
          configOptions: {
            boolean: {},
          },
        },
        plan: {},
        // Claude Agent ACP uses this ACP-reserved extension capability to
        // forward nested subagent text, thinking, and tool updates. It is
        // harmless for agents that do not implement the extension: ACP
        // clients and agents must treat unknown `_meta` keys as optional.
        _meta: {
          "subagent-transcript": true,
          // claude-agent-acp and codex-acp use this negotiated extension to
          // send terminal snapshots instead of forcing clients to reconstruct
          // them from provider-specific delta notifications.
          terminal_output: true,
        },
        fs: {
          readTextFile: Boolean(callbacks.readTextFile),
          writeTextFile: Boolean(callbacks.writeTextFile),
        },
        terminal: Boolean(callbacks.createTerminal),
        ...(elicitationCapabilities
          ? { elicitation: elicitationCapabilities }
          : {}),
        ...(this.options.clientNesCapabilities
          ? { nes: this.options.clientNesCapabilities }
          : {}),
        ...(this.options.positionEncodings?.length
          ? { positionEncodings: this.options.positionEncodings }
          : {}),
      },
    });
    const initializedAt = Date.now();

    this.#authMethods = initialized.authMethods ?? [];
    this.#protocolVersion = initialized.protocolVersion;
    this.#agentInfo = initialized.agentInfo ?? null;
    this.#agentCapabilities = initialized.agentCapabilities ?? {};
    this.#initializeMeta = initialized._meta ?? null;
    this.#promptCapabilities = this.#agentCapabilities.promptCapabilities ?? {};
    this.#supportsSessionFork =
      initialized.agentCapabilities?.sessionCapabilities?.fork != null;
    this.#supportsSessionList =
      initialized.agentCapabilities?.sessionCapabilities?.list != null;
    this.#supportsSessionDelete =
      initialized.agentCapabilities?.sessionCapabilities?.delete != null;
    this.#supportsSessionResume =
      initialized.agentCapabilities?.sessionCapabilities?.resume != null;
    this.#supportsSessionClose =
      initialized.agentCapabilities?.sessionCapabilities?.close != null;
    this.#supportsAdditionalDirectories =
      initialized.agentCapabilities?.sessionCapabilities?.additionalDirectories != null;
    this.#supportsLogout = initialized.agentCapabilities?.auth?.logout != null;
    this.#supportsProviders = initialized.agentCapabilities?.providers != null;
    this.#nesCapabilities = initialized.agentCapabilities?.nes ?? null;
    this.#supportsNes = this.#nesCapabilities != null;
    this.#positionEncoding = initialized.agentCapabilities?.positionEncoding ?? null;
    this.#supportsSteering =
      (initialized._meta as { steering?: { supported?: unknown } } | undefined)
        ?.steering?.supported === true;

    const cwd = this.options.agent.cwd ?? process.cwd();
    const mcpServers = this.options.mcpServers ?? [];
    const additionalDirectories = this.#supportsAdditionalDirectories
      ? this.options.additionalDirectories ?? []
      : [];
    const requestMeta = this.options.sessionRequestMeta;

    if (this.options.forkFromAcpSessionId) {
      if (!this.#supportsSessionFork || !this.#agent.unstable_forkSession) {
        throw new Error("ACP agent does not support unstable session/fork");
      }
      const forked = await this.#agent.unstable_forkSession({
        sessionId: this.options.forkFromAcpSessionId,
        cwd,
        mcpServers,
        ...(additionalDirectories.length > 0 ? { additionalDirectories } : {}),
        ...(requestMeta ? { _meta: requestMeta } : {}),
      });
      this.#sessionId = forked.sessionId;
      this.#configOptions = forked.configOptions ?? [];
      this.#modes = forked.modes ?? null;
      this.#sessionSetupMeta = forked._meta ?? null;
      this.#acceptOutOfBandUpdates = true;
      this.#logInit("fork", initStartedAt, initializedAt);
      return;
    }

    if (
      this.options.resumeAcpSessionId &&
      this.#supportsSessionResume &&
      this.#agent.resumeSession
    ) {
      try {
        const resumed = await this.#agent.resumeSession({
          sessionId: this.options.resumeAcpSessionId,
          cwd,
          mcpServers,
          ...(additionalDirectories.length > 0 ? { additionalDirectories } : {}),
          ...(requestMeta ? { _meta: requestMeta } : {}),
        });
        this.#sessionId = this.options.resumeAcpSessionId;
        this.#configOptions = resumed.configOptions ?? [];
        this.#modes = resumed.modes ?? null;
        this.#sessionSetupMeta = resumed._meta ?? null;
        this.#acceptOutOfBandUpdates = true;
        this.#logInit("resume", initStartedAt, initializedAt);
        return;
      } catch (error) {
        console.error(
          `[acp] session/resume(${this.options.resumeAcpSessionId}) failed, falling back to load/new:`,
          error,
        );
      }
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
          ...(additionalDirectories.length > 0 ? { additionalDirectories } : {}),
          ...(requestMeta ? { _meta: requestMeta } : {}),
        });
        this.#sessionId = this.options.resumeAcpSessionId;
        this.#configOptions = loaded?.configOptions ?? [];
        this.#modes = loaded?.modes ?? null;
        this.#sessionSetupMeta = loaded?._meta ?? null;
        this.#acceptOutOfBandUpdates = true;
        this.#logInit("load", initStartedAt, initializedAt);
        return;
      } catch (error) {
        console.error(
          `[acp] session/load(${this.options.resumeAcpSessionId}) failed, falling back to new:`,
          error,
        );
      }
    }

    const created = await this.#agent.newSession({
      cwd,
      mcpServers,
      ...(additionalDirectories.length > 0 ? { additionalDirectories } : {}),
      ...(requestMeta ? { _meta: requestMeta } : {}),
    });
    this.#sessionId = created.sessionId;
    this.#configOptions = created.configOptions ?? [];
    this.#modes = created.modes ?? null;
    this.#sessionSetupMeta = created._meta ?? null;
    this.#acceptOutOfBandUpdates = true;
    this.#logInit("new", initStartedAt, initializedAt);
  }

  #createClient(
    callbacks: ClientCallbacks,
    supportsUrlElicitation: boolean,
  ): Client {
    return {
      sessionUpdate: async (params) => {
        const update = preserveAcpNotificationContext(params);
        this.#receiveInboundEvent(update, isIdleSessionUpdate(update));
      },
      requestPermission: async (params) => {
        return this.#runClientRequest("session/request_permission", params, async () => {
          if (!callbacks.requestPermission) {
            return { outcome: { outcome: "cancelled" as const } };
          }
          try {
            return await callbacks.requestPermission(params);
          } catch (error) {
            this.#pushEvent({ type: "requestPermissionError", error: String(error) });
            return { outcome: { outcome: "cancelled" as const } };
          }
        });
      },
      readTextFile: callbacks.readTextFile
        ? async (params) => this.#runClientRequest(
            "fs/read_text_file",
            params,
            () => callbacks.readTextFile!(params),
          )
        : undefined,
      writeTextFile: callbacks.writeTextFile
        ? async (params) => this.#runClientRequest(
            "fs/write_text_file",
            params,
            () => callbacks.writeTextFile!(params),
          )
        : undefined,
      createTerminal: callbacks.createTerminal
        ? async (params) => this.#runClientRequest(
            "terminal/create",
            params,
            () => callbacks.createTerminal!(params),
          )
        : undefined,
      terminalOutput: callbacks.terminalOutput
        ? async (params) => this.#runClientRequest(
            "terminal/output",
            params,
            () => callbacks.terminalOutput!(params),
          )
        : undefined,
      releaseTerminal: callbacks.releaseTerminal
        ? async (params) => this.#runClientRequest(
            "terminal/release",
            params,
            () => callbacks.releaseTerminal!(params),
          )
        : undefined,
      waitForTerminalExit: callbacks.waitForTerminalExit
        ? async (params) => this.#runClientRequest(
            "terminal/wait_for_exit",
            params,
            () => callbacks.waitForTerminalExit!(params),
          )
        : undefined,
      killTerminal: callbacks.killTerminal
        ? async (params) => this.#runClientRequest(
            "terminal/kill",
            params,
            () => callbacks.killTerminal!(params),
          )
        : undefined,
      unstable_createElicitation: callbacks.createElicitation
        ? async (params) => {
            const response = await this.#runClientRequest(
              "elicitation/create",
              params,
              () => callbacks.createElicitation!(params),
            );
            if (
              params.mode === "url"
              && response.action === "accept"
              && typeof params.elicitationId === "string"
            ) {
              this.#outstandingUrlElicitations.add(params.elicitationId);
            }
            return response;
          }
        : undefined,
      unstable_completeElicitation: supportsUrlElicitation
        ? async (params) => {
            if (!this.#outstandingUrlElicitations.delete(params.elicitationId)) return;
            this.#receiveClientNotification("elicitation/complete", params);
            await callbacks.completeElicitation?.(params);
            this.#receiveInboundEvent({
              type: "acp.elicitation_complete",
              method: "elicitation/complete",
              params,
            });
          }
        : undefined,
      extMethod: async (method, params) => this.#runClientRequest(
        method,
        params,
        async () => {
          if (method === "mcp/connect" && callbacks.connectMcp) {
            return callbacks.connectMcp(params as schema.ConnectMcpRequest);
          }
          if (method === "mcp/message" && callbacks.messageMcp) {
            return await callbacks.messageMcp(
              params as schema.MessageMcpRequest,
            ) as Record<string, unknown>;
          }
          if (method === "mcp/disconnect" && callbacks.disconnectMcp) {
            return (await callbacks.disconnectMcp(
              params as schema.DisconnectMcpRequest,
            )) ?? {};
          }
          this.#receiveInboundEvent({
            type: "acp.extension_request",
            method,
            params,
          });
          if (callbacks.extensionRequest) {
            return callbacks.extensionRequest(method, params);
          }
          throw RequestError.methodNotFound(method);
        },
      ),
      extNotification: async (method, params) => {
        this.#receiveClientNotification(method, params);
        try {
          if (method === "mcp/message" && callbacks.notifyMcp) {
            await callbacks.notifyMcp(params as schema.MessageMcpNotification);
            this.#receiveInboundEvent({
              type: "acp.mcp_notification",
              method,
              params,
            });
            return;
          }
          await callbacks.extensionNotification?.(method, params);
        } catch (error) {
          console.error("[acp] extension notification callback failed:", error);
        }
        this.#receiveInboundEvent({
          type: "acp.extension_notification",
          method,
          params,
        });
      },
    };
  }

  async #runClientRequest<T>(
    method: string,
    params: unknown,
    invoke: () => Promise<T> | T,
  ): Promise<T> {
    const requestId = `client-request-${this.#nextClientRequestId++}`;
    this.#receiveInboundEvent({
      type: "acp.client_request",
      requestId,
      method,
      params,
    });
    try {
      const result = await invoke();
      this.#receiveInboundEvent({
        type: "acp.client_response",
        requestId,
        method,
        result,
      });
      return result;
    } catch (error) {
      this.#receiveInboundEvent({
        type: "acp.client_error",
        requestId,
        method,
        error: clientCallbackError(error),
      });
      throw error;
    }
  }

  #receiveClientNotification(method: string, params: unknown): void {
    this.#receiveInboundEvent({
      type: "acp.client_notification",
      method,
      params,
    });
  }

  #receiveInboundEvent(event: unknown, allowedBeforeSessionReady = false): void {
    if (this.#activePromptCount === 0) {
      if (!this.#acceptOutOfBandUpdates && !allowedBeforeSessionReady) return;
      if (this.#acceptOutOfBandUpdates && this.options.onOutOfBandSessionUpdate) {
        try {
          this.options.onOutOfBandSessionUpdate(event);
        } catch (error) {
          console.error("[acp] out-of-band session update callback failed:", error);
        }
        return;
      }
    }
    this.#pushEvent(event);
  }

  #logInit(mode: "new" | "load" | "fork" | "resume", startedAt: number, initializedAt: number): void {
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
      if (this.#modes) this.#modes = { ...this.#modes, currentModeId: modeId };
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

  async listSessions(
    params: schema.ListSessionsRequest = {},
  ): Promise<schema.ListSessionsResponse> {
    if (!this.#supportsSessionList || !this.#agent?.listSessions) {
      throw new Error("ACP agent does not support session/list");
    }
    return this.#agent.listSessions(params);
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!this.#supportsSessionDelete || !this.#agent?.deleteSession) {
      throw new Error("ACP agent does not support session/delete");
    }
    await this.#agent.deleteSession({ sessionId });
  }

  async logout(): Promise<void> {
    if (!this.#supportsLogout || !this.#agent?.logout) {
      throw new Error("ACP agent does not support logout");
    }
    await this.#agent.logout({});
  }

  async listProviders(): Promise<schema.ListProvidersResponse> {
    if (!this.#supportsProviders || !this.#agent?.unstable_listProviders) {
      throw new Error("ACP agent does not support providers/list");
    }
    return this.#agent.unstable_listProviders({});
  }

  async setProvider(params: schema.SetProviderRequest): Promise<void> {
    if (!this.#supportsProviders || !this.#agent?.unstable_setProvider) {
      throw new Error("ACP agent does not support providers/set");
    }
    await this.#agent.unstable_setProvider(params);
  }

  async disableProvider(providerId: schema.ProviderId): Promise<void> {
    if (!this.#supportsProviders || !this.#agent?.unstable_disableProvider) {
      throw new Error("ACP agent does not support providers/disable");
    }
    await this.#agent.unstable_disableProvider({ providerId });
  }

  async requestExtension(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    if (!this.#agent?.extMethod) {
      throw new Error("ACP connection does not support extension requests");
    }
    return this.#agent.extMethod(method, params);
  }

  async notifyExtension(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<void> {
    if (!this.#agent?.extNotification) {
      throw new Error("ACP connection does not support extension notifications");
    }
    await this.#agent.extNotification(method, params);
  }

  async startNes(
    params: schema.StartNesRequest,
  ): Promise<schema.StartNesResponse> {
    this.#assertNesMethod(this.#agent?.unstable_startNes, "nes/start");
    return this.#agent.unstable_startNes(params);
  }

  async suggestNes(
    params: schema.SuggestNesRequest,
  ): Promise<schema.SuggestNesResponse> {
    this.#assertNesMethod(this.#agent?.unstable_suggestNes, "nes/suggest");
    return this.#agent.unstable_suggestNes(params);
  }

  async closeNes(
    params: schema.CloseNesRequest,
  ): Promise<schema.CloseNesResponse | void> {
    this.#assertNesMethod(this.#agent?.unstable_closeNes, "nes/close");
    return this.#agent.unstable_closeNes(params);
  }

  async didOpenDocument(
    params: schema.DidOpenDocumentNotification,
  ): Promise<void> {
    this.#assertNesDocumentEvent("didOpen", this.#agent?.unstable_didOpenDocument);
    await this.#agent.unstable_didOpenDocument(params);
  }

  async didChangeDocument(
    params: schema.DidChangeDocumentNotification,
  ): Promise<void> {
    this.#assertNesDocumentEvent("didChange", this.#agent?.unstable_didChangeDocument);
    await this.#agent.unstable_didChangeDocument(params);
  }

  async didCloseDocument(
    params: schema.DidCloseDocumentNotification,
  ): Promise<void> {
    this.#assertNesDocumentEvent("didClose", this.#agent?.unstable_didCloseDocument);
    await this.#agent.unstable_didCloseDocument(params);
  }

  async didSaveDocument(
    params: schema.DidSaveDocumentNotification,
  ): Promise<void> {
    this.#assertNesDocumentEvent("didSave", this.#agent?.unstable_didSaveDocument);
    await this.#agent.unstable_didSaveDocument(params);
  }

  async didFocusDocument(
    params: schema.DidFocusDocumentNotification,
  ): Promise<void> {
    this.#assertNesDocumentEvent("didFocus", this.#agent?.unstable_didFocusDocument);
    await this.#agent.unstable_didFocusDocument(params);
  }

  async acceptNes(params: schema.AcceptNesNotification): Promise<void> {
    this.#assertNesMethod(this.#agent?.unstable_acceptNes, "nes/accept");
    await this.#agent.unstable_acceptNes(params);
  }

  async rejectNes(params: schema.RejectNesNotification): Promise<void> {
    this.#assertNesMethod(this.#agent?.unstable_rejectNes, "nes/reject");
    await this.#agent.unstable_rejectNes(params);
  }

  #assertNesMethod(
    method: ((params: never) => unknown) | undefined,
    name: string,
  ): asserts method is (params: never) => unknown {
    if (!this.#supportsNes || typeof method !== "function") {
      throw new Error(`ACP agent does not support ${name}`);
    }
  }

  #assertNesDocumentEvent(
    event: keyof schema.NesDocumentEventCapabilities,
    method: ((params: never) => unknown) | undefined,
  ): asserts method is (params: never) => unknown {
    const capability = this.#nesCapabilities?.events?.document?.[event];
    if (capability == null || typeof method !== "function") {
      throw new Error(`ACP agent does not support document/${event}`);
    }
  }

  prompt(
    input: string | readonly schema.ContentBlock[],
    options?: { abortSignal?: AbortSignal },
  ): AsyncIterable<unknown> {
    if (this.#disposed) throw new Error(`AcpSession ${this.id} is disposed`);
    return this.#prompt(input, options);
  }

  async steer(input: string | readonly schema.ContentBlock[]): Promise<SteeringOutcome> {
    if (!this.#agent || !this.#sessionId) throw new Error("AcpSession not initialized");
    if (!this.#supportsSteering) {
      throw new Error("ACP agent did not negotiate _session/steering");
    }
    if (!this.#agent.extMethod) throw new Error("ACP connection does not support extensions");
    const prompt =
      typeof input === "string"
        ? [{ type: "text" as const, text: input }]
        : [...input];
    const response = await this.#agent.extMethod("_session/steering", {
      sessionId: this.#sessionId,
      prompt,
      _meta: { steering: { idleBehavior: "promptRequired" } },
    });
    const outcome = response.outcome;
    if (
      outcome !== "injected"
      && outcome !== "promptRequired"
      && outcome !== "startedNewTurn"
      && outcome !== "failed"
    ) {
      throw new Error(`Invalid _session/steering outcome: ${String(outcome)}`);
    }
    return outcome;
  }

  async cancelCurrentTurn(): Promise<void> {
    if (!this.#agent || !this.#sessionId) throw new Error("AcpSession not initialized");
    await this.#agent.cancel({ sessionId: this.#sessionId });
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
    const turnAbort = new AbortController();
    const onAbort = () => {
      Promise.resolve(this.#agent.cancel({ sessionId: this.#sessionId }))
        .catch(() => {});
    };
    const abortTurn = () => turnAbort.abort();
    const timer = this.options.perTurnTimeoutMs
      ? setTimeout(() => turnAbort.abort(), this.options.perTurnTimeoutMs)
      : undefined;
    options?.abortSignal?.addEventListener("abort", abortTurn, { once: true });
    turnAbort.signal.addEventListener("abort", onAbort, { once: true });
    if (options?.abortSignal?.aborted) turnAbort.abort();

    this.#activePromptCount += 1;
    const prompt = typeof input === "string" ? [{ type: "text" as const, text: input }] : [...input];
    const done = Promise.resolve(
      this.#agent.prompt({ sessionId: this.#sessionId, prompt }),
    )
      .finally(() => {
        this.#activePromptCount = Math.max(0, this.#activePromptCount - 1);
        if (timer) clearTimeout(timer);
        options?.abortSignal?.removeEventListener("abort", abortTurn);
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
    if (this.#supportsSessionClose && this.#sessionId && this.#agent?.closeSession) {
      try {
        await this.#agent.closeSession({ sessionId: this.#sessionId });
      } catch (error) {
        console.warn(`[acp] session/close(${this.#sessionId}) failed:`, error);
      }
    }
    this.#disposed = true;
    this.#outstandingUrlElicitations.clear();
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

function clientCallbackError(error: unknown): { message: string; code?: number } {
  const code =
    error !== null
    && typeof error === "object"
    && typeof (error as { code?: unknown }).code === "number"
      ? (error as { code: number }).code
      : undefined;
  const message = code === -32601
    ? "Method not found"
    : error instanceof Error
      ? error.message
      : String(error);
  return {
    message,
    ...(code !== undefined ? { code } : {}),
  };
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
