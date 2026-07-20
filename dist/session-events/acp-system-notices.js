const CODEX_SKILL_CONTEXT_WARNING = /^Warning:\s*Skill descriptions were shortened to fit the \d+% skills context budget\./;
function asRecord(value) {
    return value !== null && typeof value === "object"
        ? value
        : null;
}
export function extractAcpSystemNotice(event) {
    const outer = asRecord(event);
    const wrapped = asRecord(outer?.update);
    const inner = wrapped ?? outer;
    if (!inner || inner.sessionUpdate !== "agent_message_chunk")
        return null;
    const meta = asRecord(inner._meta);
    const codex = asRecord(meta?.codex);
    if (codex?.phase === "final_answer")
        return null;
    const content = asRecord(inner.content);
    const text = typeof content?.text === "string" ? content.text.trim() : "";
    if (!CODEX_SKILL_CONTEXT_WARNING.test(text))
        return null;
    return { message: text, tone: "warning" };
}
//# sourceMappingURL=acp-system-notices.js.map