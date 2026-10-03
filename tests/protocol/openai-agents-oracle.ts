/**
 * Executes the OpenAI Agents mapping from backchat commit `64fd74d`
 * (`src/main/direct-agent-runtime.ts`) by transpiling that file and calling
 * `#item`, `#turn`, `#openaiEvent`, `#pending`, `#vendor`, `#event`, and
 * `#wrap`. Tests compare decoder output to this oracle.
 *
 * The fixture is the upstream file, byte for byte. Clock still comes from
 * `new Date()` inside those methods; tests freeze it.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createOpenMAEvent, createVendorEvent, type OpenMAEvent } from "../../src/session-events/openma.js";

const FIXTURE = new URL(
  "../fixtures/backchat/64fd74d/direct-agent-runtime.ts.txt",
  import.meta.url,
);
const FIXTURE_SHA256 = "60f0b2ce970bd22891be7880fcb391e2352619534b644feec80f46732744d6d7";

export interface BackchatWrappedEvent {
  canonical: OpenMAEvent;
  pendingActions?: unknown;
  [key: string]: unknown;
}

export interface BackchatOracle {
  item(sessionId: string, item: unknown): BackchatWrappedEvent;
  turn(sessionId: string, turn: unknown): BackchatWrappedEvent;
  pending(sessionId: string, id: string, session: unknown): BackchatWrappedEvent;
  openaiEvent(sessionId: string, event: unknown): BackchatWrappedEvent[];
}

const METHOD_NAMES = ["wrap", "event", "item", "vendor", "turn", "pending", "openaiEvent"] as const;

function sliceBalanced(source: string, openBrace: number): string {
  let depth = 0;
  let quote: "'" | "\"" | "`" | null = null;
  for (let i = openBrace; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === "\"" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openBrace, i + 1);
    }
  }
  throw new Error("backchat oracle: unclosed block");
}

function methodSource(js: string, name: (typeof METHOD_NAMES)[number]): string {
  const match = new RegExp(`(?:^|\\n)[ \\t]*(\\*?)#${name}\\(`).exec(js);
  if (!match || match.index === undefined) {
    throw new Error(`backchat oracle: missing #${name}`);
  }
  const start = js[match.index] === "\n" ? match.index + 1 : match.index;
  const open = js.indexOf("{", start);
  const body = sliceBalanced(js, open);
  const signature = js.slice(start, open).trim().replace(/^(\*)?#/, "$1");
  return `${signature}${body}`.replaceAll("this.#", "this.");
}

function statement(js: string, keyword: string): string {
  const start = js.indexOf(keyword);
  if (start < 0) throw new Error(`backchat oracle: missing ${keyword}`);
  const end = js.indexOf(";", start);
  if (end < 0) throw new Error(`backchat oracle: unterminated ${keyword}`);
  return js.slice(start, end + 1);
}

export function loadBackchatOracle(): BackchatOracle {
  const raw = readFileSync(FIXTURE, "utf8");
  const hash = createHash("sha256").update(raw).digest("hex");
  if (hash !== FIXTURE_SHA256) {
    throw new Error(`backchat 64fd74d fixture hash is ${hash}, expected ${FIXTURE_SHA256}`);
  }
  const js = ts.transpileModule(raw, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  const body = `
    ${statement(js, "const text =")}
    ${statement(js, "const iso =")}
    return {
      options: { provider: "openai-agents" },
      ${METHOD_NAMES.map((name) => methodSource(js, name)).join(",\n")}
    };
  `;
  const runtime = new Function("createOpenMAEvent", "createVendorEvent", body)(
    createOpenMAEvent,
    createVendorEvent,
  ) as BackchatOracle & {
    openaiEvent: (sessionId: string, event: unknown) => Iterable<BackchatWrappedEvent>;
  };
  return {
    item: (sessionId, item) => runtime.item(sessionId, item),
    turn: (sessionId, turn) => runtime.turn(sessionId, turn),
    pending: (sessionId, id, session) => runtime.pending(sessionId, id, session),
    openaiEvent: (sessionId, event) => [...runtime.openaiEvent(sessionId, event)],
  };
}
