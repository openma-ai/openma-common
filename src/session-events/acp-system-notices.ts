export type AcpSystemNotice = {
  message: string;
  tone: "warning";
};

const CODEX_SKILL_CONTEXT_WARNING =
  /^Warning:\s*Skill descriptions were shortened to fit the (?:\d+%\s+)?skills context budget\./;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export function splitAcpSystemNoticeText(text: string): {
  notice?: string;
  transcript: string;
} {
  const candidate = text.trimStart();
  if (!CODEX_SKILL_CONTEXT_WARNING.test(candidate)) {
    return { transcript: text };
  }
  const paragraphBreak = candidate.search(/\r?\n[\t ]*\r?\n/);
  if (paragraphBreak < 0) {
    return { notice: candidate.trim(), transcript: "" };
  }
  const separator = candidate
    .slice(paragraphBreak)
    .match(/^\r?\n[\t ]*\r?\n/)?.[0] ?? "";
  return {
    notice: candidate.slice(0, paragraphBreak).trim(),
    transcript: candidate.slice(paragraphBreak + separator.length).trimStart(),
  };
}

export function extractAcpSystemNotice(event: unknown): AcpSystemNotice | null {
  const outer = asRecord(event);
  const wrapped = asRecord(outer?.update);
  const inner = wrapped ?? outer;
  if (!inner || inner.sessionUpdate !== "agent_message_chunk") return null;

  const meta = asRecord(inner._meta);
  const codex = asRecord(meta?.codex);
  if (codex?.phase === "final_answer") return null;

  const piAcp = asRecord(meta?.piAcp);
  const piNotify = asRecord(piAcp?.notify);
  const piLevel = piNotify?.level;

  const content = asRecord(inner.content);
  const text = typeof content?.text === "string" ? content.text.trim() : "";
  if (codex?.phase !== "final_answer" && splitAcpSystemNoticeText(text).notice) {
    return { message: splitAcpSystemNoticeText(text).notice!, tone: "warning" };
  }
  if (piLevel !== "warning" && piLevel !== "error") return null;

  return { message: text, tone: "warning" };
}
