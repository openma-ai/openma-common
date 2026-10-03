# Inclusive ACP fork

`openma-common` owns the shared inclusive-fork contract. Clients (backchat, clash) call `forkSupport()` and do not hardcode harness names or versions. Adapters that we ship (dsh-acp, pi-acp) copy `ACP_INCLUSIVE_FORK_CAPABILITY` and advertise it from `initialize`. They do not depend on this private package.

```ts
// Contract owned by openma-ai/openma-common (src/acp-fork/index.ts, ACP_INCLUSIVE_FORK_CAPABILITY). Keep byte-identical.
```

This document is the contract those four repositories keep byte-identical. Sections B, C, and D below are the source text.

## Dependency order

1. Land and tag this package first. backchat (and later clash) can upgrade only after that immutable tag exists, because they install `@openma/common` by git tag.
2. dsh-acp and pi-acp only copy the capability constant and can land in parallel with that tag. They must not wait on a client upgrade, and clients must not wait on those adapters before using `forkSupport()` against agents that already advertise the key or match the internal verified-adapter table.
3. This change does not bump `package.json`, publish to npm, or create a tag.

## Client usage

Browser and renderer clients import the client-safe entry (no `node:` imports, no hashing):

```ts
import {
  acpForkPointsFromMessages,
  forkSupport,
  type AcpForkPoint,
} from "@openma/common/acp-fork";

const support = forkSupport(initializeResponse);
if (support.level !== "message") {
  // Show support.message. Do not send jetbrains.air.fork.
  throw new Error(`${support.reason}: ${support.message}`);
}

const points: AcpForkPoint[] = acpForkPointsFromMessages(topLevelAssistantMessages);
await runtime.start({
  agent,
  forkFromAcpSessionId,
  forkPoint: points[selected],
  sessionRequestMeta: { claudeCode: existingClaudeMeta },
});
```

`topLevelAssistantMessages` is in time order. The caller has already merged `<id>:segment:<n>` chunks into `<id>` and concatenated that message's `agent_message_chunk` text. `messageOccurrence` is the 1-based count of identical text in that prefix.

`acpForkRequestMeta()` (SHA-256 fingerprint and `jetbrains.air.fork` meta) lives in `@openma/common/acp-runtime` only. The runtime computes it when `SessionOptions.forkPoint` is set; browser clients do not call it.

`SessionOptions.forkPoint` is valid only together with `forkFromAcpSessionId`. The runtime calls `forkSupport()` on the initialize result after initialize and before `session/fork`. When the level is not `"message"`, start throws an `Error` whose message contains both `reason` and `message`, and it does not send `session/fork`. The same throw happens when the caller placed `jetbrains.air.fork` on `sessionRequestMeta` and the agent cannot fork from a message. A supported `forkPoint` is deep-merged into `sessionRequestMeta` for the fork request only.

`session.forkSupport` is `forkSupport(session)`. `supportsSessionFork` is unchanged.

## B. 适配器端解析规则

适配器端解析规则（参考已验证实现：@agentclientprotocol/codex-acp `src/SessionFork.ts`（≥1.10.0）与 @agentclientprotocol/claude-agent-acp `dist/fork-session.js`（≥0.75.1）；在其基础上把"错误必须显式"收紧）

1. `_meta.jetbrains.air.fork` 不存在 → 走原有整会话 fork（行为不变）。
2. 存在但不是对象，或 `version !== 1` → ACP `invalidParams`（JSON-RPC -32602），消息 `Unsupported jetbrains.air.fork version`。**不得**静默退化为整会话 fork。
3. `messageId` 必须是 trim 后非空字符串，否则 invalidParams `jetbrains.air.fork messageId must be a non-empty string`。
4. `messageFingerprint` 可选；若出现必须匹配 `/^sha256:[0-9a-f]{64}$/`，否则 invalidParams。
5. `messageOccurrence` 可选，缺省 1；必须是正的 safe integer，否则 invalidParams。
6. 定位顺序：
   a. 候选 id = [messageId]，若 messageId 以 `:segment:\d+` 结尾再追加去掉后缀的 id。按候选顺序在源会话持久化历史（只看顶层 assistant 消息，不含 subagent/sidechain）中精确匹配 messageId。
   b. 若精确命中且请求带 fingerprint，但该消息的 fingerprint 不等于请求值 → 视为"id 未命中"（防止进程重启后计数型 id 指向别的消息），进入 c。
   c. 若未命中且带 fingerprint：按时间顺序收集 fingerprint 相等的 assistant 消息；恰好 1 个 → 选它；否则取第 messageOccurrence 个（1-based）。
   d. 仍未命中 → `RequestError.invalidParams({ messageId }, "Fork point message <messageId> was not found in session <sessionId>")`。**不得**静默整会话 fork。
7. 截断：新会话历史 = 源会话历史从头到目标 assistant 消息（含）为止。若目标消息本身带有 tool call，需保证新会话对模型仍是合法 transcript（要么一并保留其结果、要么剔除这些 tool call），在 README 里写明选择。新会话 `session/load` 回放必须恰好以目标消息结束；在新会话里 `session/prompt` 从该点继续。
8. 只有已完成的消息可作为 fork 点；源会话若正在运行，只看已持久化的部分。

### 工具调用截断选择

选择是：**剔除目标消息里那些结果落在该消息之后的 tool call**。

新会话历史停在目标 assistant 消息（含它的可见文本）。目标消息之前的工具调用和结果原样保留。若目标消息自己带有 tool call，而对应结果排在该消息之后，适配器从截断后的目标消息中去掉这些 tool call，不把结果追加到目标消息后面。这样 transcript 对模型仍然合法，并且 `session/load` 回放恰好以目标消息结束。

## C. 能力声明

在 `initialize` 响应里：

```json
"agentCapabilities": {
  "sessionCapabilities": { "fork": {} },
  "_meta": { "jetbrains": { "air": { "fork": { "version": 1, "inclusive": true } } } }
}
```

- 路径：`agentCapabilities._meta.jetbrains.air.fork`（嵌套对象，与请求侧 `_meta.jetbrains.air.fork` 同一路径，**不是**带点号的扁平 key）。
- 值：`{ "version": 1, "inclusive": true }`，两个字段都必填；`version` 是请求侧扩展版本号，`inclusive: true` 表示按 B.7 含目标消息截断。
- 必须与 `sessionCapabilities.fork: {}` 同时出现（消息级 fork 是 `session/fork` 的扩展）。
- 与 `_meta` 下已有的 key（dsh 的 `dsh.cordis`、pi 的 `pi` / authStatus 等）深合并，不得覆盖。
- openma-common 中的定义（逐字）：

```ts
/** Capability advertised at `initialize.agentCapabilities._meta.jetbrains.air.fork`
 * by agents that implement the inclusive `jetbrains.air.fork` v1 request meta on session/fork. */
export const ACP_INCLUSIVE_FORK_VERSION = 1 as const;
export interface AcpInclusiveForkCapability {
  version: typeof ACP_INCLUSIVE_FORK_VERSION;
  inclusive: true;
}
export const ACP_INCLUSIVE_FORK_CAPABILITY: AcpInclusiveForkCapability = Object.freeze({
  version: ACP_INCLUSIVE_FORK_VERSION,
  inclusive: true,
});
/** `{ jetbrains: { air: { fork: ACP_INCLUSIVE_FORK_CAPABILITY } } }`, to deep-merge into agentCapabilities._meta. */
export function acpInclusiveForkCapabilityMeta(): { jetbrains: { air: { fork: AcpInclusiveForkCapability } } };
```

`acpInclusiveForkCapabilityMeta()` 的返回值用来深合并进 `agentCapabilities._meta`。

## D. openma-common 统一 API

```ts
export type AcpForkSupportLevel = "none" | "session" | "message";
export type AcpForkSupportReason =
  | "not-initialized"                  // none：输入为 null/undefined 或没有 agentCapabilities
  | "session-fork-not-advertised"      // none：没有 sessionCapabilities.fork
  | "message-fork-not-advertised"      // session：有 sessionCapabilities.fork，无能力 key
  | "message-fork-capability-invalid"  // session：key 存在但结构/版本不认识（version!==1 或 inclusive!==true）
  | "message-fork-advertised"          // message：能力 key 合法
  | "message-fork-verified-adapter";   // message：上游第三方适配器的已验证版本（见下），无能力 key
export interface AcpForkSupport {
  level: AcpForkSupportLevel;
  reason: AcpForkSupportReason;
  /** 英文、可直接展示给用户的说明，例如 "This agent can fork the whole session but not from a specific message." */
  message: string;
  /** level === "message" 时存在 */
  messageFork?: { version: 1; inclusive: true; source: "capability" | "verified-adapter" };
}
export interface AcpForkSupportSource {
  agentCapabilities?: schema.AgentCapabilities | null;
  agentInfo?: schema.Implementation | null;
}
/** 接受 AcpSession（有 agentCapabilities/agentInfo getter）或 InitializeResponse。 */
export function forkSupport(source: AcpForkSupportSource | null | undefined): AcpForkSupport;
```

判定顺序：无输入/无 agentCapabilities → none/not-initialized；无 `sessionCapabilities.fork` → none/session-fork-not-advertised（即使声明了能力 key）；能力 key 合法 → message/message-fork-advertised；key 存在但非法 → session/message-fork-capability-invalid；无 key 但 `agentInfo` 命中 openma-common 内部的已验证表（`codex-acp`/`@agentclientprotocol/codex-acp` ≥ 1.10.0，`claude-acp`/`@agentclientprotocol/claude-agent-acp` ≥ 0.75.1，严格 x.y.z 比较，即 clash 当前 `supportsAcpMessageFork` 的内容，从客户端迁入这里）→ message/message-fork-verified-adapter；否则 session/message-fork-not-advertised。

该已验证表是 openma-common 内部实现细节、不导出，只用于不会发出新能力 key 的上游第三方适配器；自有适配器（dsh-acp、pi-acp）一律走能力 key。

`acpForkPointsFromMessages()` 也从本包导出。输入是按时间顺序、已经把 `:segment:N` 分段归并好的顶层 assistant 消息；每条的 `messageOccurrence` 是该文本在前缀中的 1-based 出现次数。
