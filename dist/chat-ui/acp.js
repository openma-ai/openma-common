import { reduceTurn, parseAcpEvent, } from "../session-events/acp.js";
/** Projects Backchat's ACP turn boundary onto the common AI SDK-shaped parts.
 * It is pure, deterministic, and deliberately does not read session storage. */
export function projectAcpChatTurn(input, options = {}) {
    const rendered = options.rendered ?? reduceTurn(input.events);
    const projectedEndedAt = input.endedAt ?? (input.status === "running"
        ? undefined
        : input.events.at(-1)?.receivedAt ?? input.startedAt);
    const toolsById = new Map(rendered.tools.map((tool) => [tool.toolCallId, tool]));
    const thoughtDurations = projectThoughtDurations(input);
    const items = [];
    if (input.promptText || input.attachments?.length) {
        items.push({
            id: `${input.id}:prompt`,
            kind: "message",
            role: "user",
            text: input.promptText,
            status: "complete",
            ...(input.attachments?.length
                ? { content: { attachments: input.attachments } }
                : {}),
        });
    }
    rendered.timeline.forEach((entry, index) => {
        if (entry.kind === "assistant_text") {
            items.push({
                id: `${input.id}:assistant:${index}`,
                kind: "message",
                role: "assistant",
                text: entry.text,
                status: input.status === "running" && index === rendered.timeline.length - 1
                    ? "streaming"
                    : "complete",
                ...(entry.phase ? { phase: entry.phase } : {}),
                content: { timelineIndex: index },
            });
            return;
        }
        if (entry.kind === "thought") {
            items.push({
                id: entry.messageId
                    ? `${input.id}:thought:${entry.messageId}`
                    : `${input.id}:thought:${index}`,
                ...(entry.messageId ? { messageId: entry.messageId } : {}),
                kind: "thinking",
                role: "assistant",
                text: entry.text,
                status: input.status === "running" && index === rendered.timeline.length - 1
                    ? "streaming"
                    : "complete",
                content: {
                    timelineIndex: index,
                    durationSeconds: thoughtDurations.get(thoughtTimingKey(entry.messageId)) ?? 0,
                },
            });
            return;
        }
        if (options.omitToolIds?.has(entry.toolCallId))
            return;
        const tool = toolsById.get(entry.toolCallId);
        if (tool)
            items.push(projectAcpTool(tool, input.status));
    });
    const hasAssistantTimeline = rendered.timeline.some((entry) => entry.kind === "assistant_text");
    if (!hasAssistantTimeline && input.assistantText) {
        items.push({
            id: `${input.id}:assistant:replay`,
            kind: "message",
            role: "assistant",
            text: input.assistantText,
            phase: "final_answer",
            status: input.status === "running" ? "streaming" : "complete",
            content: { replay: true },
        });
    }
    return {
        id: input.id,
        status: projectTurnStatus(input.status),
        items,
        ...(input.errorMessage ? { error: input.errorMessage } : {}),
        ...(toTimestamp(input.startedAt) ? { startedAt: toTimestamp(input.startedAt) } : {}),
        ...(toTimestamp(projectedEndedAt)
            ? { endedAt: toTimestamp(projectedEndedAt) }
            : {}),
    };
}
function projectAcpTool(tool, turnStatus) {
    return {
        id: tool.toolCallId,
        kind: "tool",
        ...(tool.toolName ? { name: tool.toolName } : {}),
        ...(tool.title ? { title: tool.title } : {}),
        ...(tool.kind ? { toolKind: tool.kind } : {}),
        status: projectToolStatus(tool.status, turnStatus),
        ...(tool.rawInput !== undefined ? { rawInput: tool.rawInput } : {}),
        ...(tool.rawOutput !== undefined ? { rawOutput: tool.rawOutput } : {}),
        ...(tool.content ? { content: tool.content } : {}),
        ...(tool.locations ? { locations: tool.locations } : {}),
        ...(tool.meta ? { adapterMeta: tool.meta } : {}),
        outputs: [],
    };
}
function projectToolStatus(status, turnStatus) {
    if (status === "pending" ||
        status === "in_progress" ||
        status === "completed" ||
        status === "failed" ||
        status === "cancelled") {
        if (turnStatus !== "running" &&
            (status === "pending" || status === "in_progress")) {
            return "cancelled";
        }
        return status;
    }
    return turnStatus === "running" ? "in_progress" : "cancelled";
}
function projectTurnStatus(status) {
    if (status === "complete")
        return "completed";
    if (status === "error")
        return "failed";
    return status;
}
function toTimestamp(value) {
    if (typeof value === "string")
        return value;
    if (typeof value === "number")
        return new Date(value).toISOString();
    return undefined;
}
function thoughtTimingKey(messageId) {
    return messageId ? `message:${messageId}` : "anonymous";
}
function projectThoughtDurations(input) {
    const spans = new Map();
    input.events.forEach((event, index) => {
        const parsed = parseAcpEvent(event.payload);
        if (parsed.kind !== "thought" || event.receivedAt === undefined)
            return;
        const key = thoughtTimingKey(parsed.messageId);
        const span = spans.get(key);
        if (span)
            span.lastIndex = index;
        else
            spans.set(key, { startedAt: event.receivedAt, lastIndex: index });
    });
    const endedAt = timestampMillis(input.endedAt);
    return new Map([...spans].map(([key, span]) => {
        const nextAt = input.events[span.lastIndex + 1]?.receivedAt;
        const lastAt = input.events.at(-1)?.receivedAt;
        const end = nextAt ?? endedAt ?? lastAt ?? span.startedAt;
        return [
            key,
            Math.max(1, Math.ceil((end - span.startedAt) / 1_000)),
        ];
    }));
}
function timestampMillis(value) {
    if (typeof value === "number")
        return value;
    if (typeof value !== "string")
        return undefined;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
//# sourceMappingURL=acp.js.map