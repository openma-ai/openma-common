const STRESS_MESSAGE_CHUNK = "Here is **bold** text, a `code` span and a list:\n\n- item one\n- item two\n\n```ts\nconst x = 1;\n```\n";
function routedTurnId(event) {
    if (event.type === "user.message" && event.data.input_kind === "steering") {
        return event.data.active_turn_id;
    }
    return event.turn_id;
}
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function trailingNewlines(text) {
    return text.match(/\n+$/)?.[0] ?? "";
}
function copyForRepeat(event, turnId, repeat, seq) {
    const data = { ...event.data };
    const copy = {
        ...event,
        event_id: `${event.event_id}-r${repeat}`,
        turn_id: turnId,
        seq,
        data,
    };
    if (typeof data.tool_call_id === "string") {
        data.tool_call_id = `${data.tool_call_id}-r${repeat}`;
    }
    if (typeof data.message_id === "string") {
        data.message_id = `${data.message_id}-r${repeat}`;
    }
    if (event.type === "agent.thinking" && repeat % 2 === 1) {
        delete data.message_id;
    }
    if (event.type === "agent.message_chunk") {
        const suffix = trailingNewlines(typeof data.text === "string" ? data.text : "");
        data.text = `${STRESS_MESSAGE_CHUNK}${suffix}`;
        if (isRecord(data.content)) {
            const contentSuffix = trailingNewlines(typeof data.content.text === "string" ? data.content.text : "");
            data.content = {
                ...data.content,
                text: `${STRESS_MESSAGE_CHUNK}${contentSuffix}`,
            };
        }
    }
    if (event.type === "user.message" && data.input_kind === "steering") {
        data.active_turn_id = turnId;
    }
    return copy;
}
export function generateStressTurn(seed, { targetEvents = 45_000 } = {}) {
    if (!Number.isSafeInteger(targetEvents) || targetEvents < 0) {
        throw new RangeError("targetEvents must be a non-negative safe integer");
    }
    const steering = seed.find((event) => event.type === "user.message" &&
        event.data.input_kind === "steering" &&
        typeof event.data.active_turn_id === "string");
    const turnId = steering?.data.active_turn_id;
    if (typeof turnId !== "string") {
        throw new TypeError("seed must contain a steering message with active_turn_id");
    }
    // Never empty: the steering message itself routes to its active turn.
    const turnEvents = seed.filter((event) => {
        if (routedTurnId(event) !== turnId)
            return false;
        return !["session.running", "session.idle", "turn.completed"].includes(event.type);
    });
    const generated = [];
    for (let repeat = 0; generated.length < targetEvents; repeat += 1) {
        for (const event of turnEvents) {
            generated.push(copyForRepeat(event, turnId, repeat, generated.length + 1));
        }
    }
    const finalTemplate = seed.find((event) => event.type === "turn.completed" && routedTurnId(event) === turnId) ?? turnEvents[0];
    generated.push({
        ...finalTemplate,
        event_id: `${finalTemplate.event_id}-stress-final`,
        type: "turn.completed",
        turn_id: turnId,
        seq: generated.length + 1,
        data: {
            ...finalTemplate.data,
            stop_reason: "end_turn",
        },
    });
    return generated;
}
//# sourceMappingURL=stress-session.js.map