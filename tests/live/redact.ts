/**
 * Strip credentials and contact details before a live stream is written to
 * disk, CI logs, or a committed fixture. Agent and run ids are replaced
 * with the same placeholders the documented decoder tests use.
 */

const SECRET_PATTERN = new RegExp(
  [
    String.raw`crsr_[A-Za-z0-9_\-]{8,}`,
    String.raw`key_[A-Za-z0-9_\-]{8,}`,
    String.raw`sk-[A-Za-z0-9_\-]{8,}`,
    String.raw`gh[pousr]_[A-Za-z0-9]{8,}`,
    String.raw`github_pat_[A-Za-z0-9_]{8,}`,
    String.raw`xox[baprs]-[A-Za-z0-9-]{8,}`,
    String.raw`AKIA[A-Z0-9]{16}`,
    String.raw`eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`,
  ].join("|"),
  "g",
);
const BEARER_PATTERN = /(?:Bearer|Basic)\s+[A-Za-z0-9._\-+/=]+/gi;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SENSITIVE_KEYS = new Set([
  "accesstoken",
  "apikey",
  "api_key",
  "authorization",
  "password",
  "secret",
  "token",
  "useremail",
  "userfirstname",
  "userlastname",
]);

export const FIXTURE_AGENT_ID = "bc-00000000-0000-0000-0000-000000000001";
export const FIXTURE_RUN_ID = "run-00000000-0000-0000-0000-000000000001";
export const FIXTURE_RUN_ID_2 = "run-00000000-0000-0000-0000-000000000002";

export function redactString(value: string, secrets: readonly string[]): string {
  let redacted = value;
  const unique = [...new Set(secrets.filter((secret) => secret.length >= 8))].sort((a, b) => b.length - a.length);
  for (const secret of unique) {
    redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted
    .replace(bearerPattern(), (match) => `${match.slice(0, match.indexOf(" "))} [redacted]`)
    .replace(secretPattern(), "[redacted]")
    .replace(emailPattern(), "[redacted-email]");
}

function bearerPattern(): RegExp {
  return new RegExp(BEARER_PATTERN.source, "gi");
}

function secretPattern(): RegExp {
  return new RegExp(SECRET_PATTERN.source, "g");
}

function emailPattern(): RegExp {
  return new RegExp(EMAIL_PATTERN.source, "gi");
}

export function redactValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return redactString(value, secrets);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, secrets));
  if (typeof value === "object" && value !== null) {
    const redacted: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      redacted[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? "[redacted]" : redactValue(entry, secrets);
    }
    return redacted;
  }
  return value;
}

export function truncateStrings<T>(value: T, maxLength: number): T {
  return truncateValue(value, maxLength) as T;
}

function truncateValue(value: unknown, maxLength: number): unknown {
  if (typeof value === "string" && value.length > maxLength) {
    return `${value.slice(0, maxLength)}…[truncated ${value.length - maxLength} chars]`;
  }
  if (Array.isArray(value)) return value.map((entry) => truncateValue(entry, maxLength));
  if (typeof value === "object" && value !== null) {
    const truncated: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) truncated[key] = truncateValue(entry, maxLength);
    return truncated;
  }
  return value;
}

export function replaceIdentifiers<T>(value: T, replacements: Readonly<Record<string, string>>): T {
  let serialized = JSON.stringify(value);
  const pairs = Object.entries(replacements)
    .filter(([from]) => from.length > 0)
    .sort((left, right) => right[0].length - left[0].length);
  for (const [from, to] of pairs) serialized = serialized.split(from).join(to);
  return JSON.parse(serialized) as T;
}

export function replaceLiveIdentifiers<T>(value: T, agentId: string, runId: string): T {
  return replaceIdentifiers(value, {
    [`https://cursor.com/agents/${agentId}`]: `https://cursor.com/agents/${FIXTURE_AGENT_ID}`,
    [agentId]: FIXTURE_AGENT_ID,
    [runId]: FIXTURE_RUN_ID,
  });
}
