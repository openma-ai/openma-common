/** Canonical full messages supersede streamed chunks with the same message id. */
export function projectResponseText(events) {
    const messages = new Map();
    let anonymous = 0;
    for (const event of events) {
        if (event.type !== "agent.message" && event.type !== "agent.message_chunk")
            continue;
        const data = objectData(event.data);
        const key = typeof data.message_id === "string" ? data.message_id : `anonymous:${anonymous}`;
        const message = messages.get(key) ?? { chunks: "" };
        const text = typeof data.text === "string" ? data.text : "";
        if (event.type === "agent.message") {
            message.final = text;
            if (typeof data.message_id !== "string")
                anonymous += 1;
        }
        else
            message.chunks += text;
        messages.set(key, message);
    }
    return [...messages.values()]
        .map((message) => message.final ?? message.chunks)
        .filter(Boolean)
        .join("\n\n");
}
/** Adapt durable project facts to the conversation column. */
export function projectCoordinatorTurns(view, runId) {
    const sessions = new Set(view.facts.sessions
        .filter((session) => session.agentId === "coordinator" && session.scopeId === view.project.id)
        .filter((session) => !runId || association(view, session.workThreadId).runId === runId)
        .map((session) => session.id));
    return view.facts.turns
        .filter((turn) => sessions.has(turn.sessionId))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map((turn) => {
        const events = view.facts.agentEvents.filter((event) => event.turn_id === turn.id);
        const trigger = view.facts.events.find((event) => event.id === turn.triggerEventId);
        const prompt = textPayload(trigger?.payload);
        const status = {
            queued: "queued",
            running: "running",
            completed: "complete",
            failed: "error",
            cancelled: "cancelled",
        };
        const failure = findLast(events, (event) => event.type === "turn.failed" || event.type === "session.error");
        const failureData = objectData(failure?.data);
        return {
            id: turn.id,
            sessionId: turn.sessionId,
            status: status[turn.state],
            promptText: prompt,
            assistantText: projectResponseText(events),
            thoughtText: events
                .filter((event) => event.type === "agent.thinking")
                .map((event) => {
                const text = objectData(event.data).text;
                return typeof text === "string" ? text : "";
            })
                .join(""),
            events,
            startedAt: Date.parse(turn.createdAt),
            ...(turn.completedAt ? { endedAt: Date.parse(turn.completedAt) } : {}),
            ...(turn.state === "failed"
                ? { errorMessage: typeof failureData.error === "string" ? failureData.error : "Turn failed." }
                : {}),
        };
    });
}
const association = (view, workThreadId) => {
    const context = [...view.facts.contexts].reverse().find((item) => item.workThreadId === workThreadId);
    const value = context?.items.find((item) => item.kind === "coordinator-association")?.value;
    const record = value && typeof value === "object" ? value : undefined;
    return {
        role: record?.role ?? (workThreadId.endsWith(":coordinator") ? "coordinator" : "worker"),
        ...(record?.workerId ? { workerId: record.workerId } : {}),
        ...(record?.runId ? { runId: record.runId } : {}),
    };
};
/** Project one work thread, independent of replacement sessions. */
export function projectThreads(view, runId) {
    const grouped = new Map();
    for (const session of view.facts.sessions) {
        if (session.scopeId !== view.project.id)
            continue;
        const current = grouped.get(session.workThreadId) ?? [];
        current.push(session);
        grouped.set(session.workThreadId, current);
    }
    const result = [];
    for (const [workThreadId, sessions] of grouped) {
        const info = association(view, workThreadId);
        if (runId && info.runId !== runId)
            continue;
        const session = [...sessions].sort((left, right) => (right.generation ?? 0) - (left.generation ?? 0) ||
            (right.lastUsedAt ?? "").localeCompare(left.lastUsedAt ?? ""))[0];
        if (!session)
            continue;
        const turns = view.facts.turns
            .filter((turn) => sessions.some((candidate) => candidate.id === turn.sessionId))
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
        const goal = view.facts.goals.find((candidate) => candidate.workThreadId === workThreadId);
        result.push({
            workThreadId,
            role: info.role,
            ...(info.workerId ? { workerId: info.workerId } : {}),
            ...(info.runId ? { runId: info.runId } : {}),
            session,
            turns,
            ...(goal ? { goal } : {}),
        });
    }
    return result;
}
const tokenLabel = (value) => {
    if (value >= 1_000_000)
        return `${Math.round(value / 100_000) / 10}m`;
    if (value >= 1_000)
        return `${Math.round(value / 100) / 10}k`;
    return String(value);
};
export function projectGoalPresentation(goal) {
    const tone = goal.status === "complete"
        ? "success"
        : goal.status === "blocked" || goal.status === "budget_limited" || goal.status === "usage_limited"
            ? "danger"
            : "neutral";
    return {
        title: goal.objective,
        status: goal.status,
        tone,
        elapsedSeconds: goal.timeUsedSeconds,
        elapsedSince: undefined,
        ...(goal.tokenBudget === undefined
            ? {}
            : { budgetLabel: `${tokenLabel(goal.tokensUsed)}/${tokenLabel(goal.tokenBudget)}` }),
        actions: {
            pause: goal.status === "active",
            resume: goal.status === "paused" || goal.status === "blocked" || goal.status === "usage_limited",
            dismiss: false,
        },
    };
}
export function projectOutcomeLabel(status) {
    return {
        active: "In progress",
        paused: "Paused",
        blocked: "Blocked",
        usage_limited: "Limit reached",
        budget_limited: "Budget reached",
        complete: "Complete",
    }[status];
}
function objectData(value) {
    return value && typeof value === "object" ? value : {};
}
function textPayload(payload) {
    const text = objectData(payload).text;
    return typeof text === "string" ? text : "";
}
function findLast(items, predicate) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (item !== undefined && predicate(item))
            return item;
    }
    return undefined;
}
//# sourceMappingURL=project-goals.js.map