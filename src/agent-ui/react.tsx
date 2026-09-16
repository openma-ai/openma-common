"use client";

import {
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import * as smd from "streaming-markdown";

import type {
  AgentUIState,
  AgentUIStore,
  AgentUIStreamSubscriber,
} from "./index.js";

export interface StreamTextPacer {
  enqueue(text: string): void;
  flush(): void;
  dispose(): void;
}

export interface StreamTextPacerOptions {
  write(text: string): void;
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
  onDrain?(): void;
}

function nextDelayMs(backlog: number): number {
  if (backlog > 160) return 4;
  if (backlog > 60) return 8;
  return 12;
}

/** Backchat main's Unicode-aware stream pacer. */
export function createStreamTextPacer({
  write,
  schedule,
  cancel,
  onDrain,
}: StreamTextPacerOptions): StreamTextPacer {
  const pending: string[] = [];
  let scheduled: unknown = null;
  let disposed = false;

  const requestTick = () => {
    if (disposed || scheduled !== null || pending.length === 0) return;
    scheduled = schedule(tick, nextDelayMs(pending.length));
  };
  const tick = () => {
    scheduled = null;
    const character = pending.shift();
    if (character !== undefined) write(character);
    if (pending.length === 0) onDrain?.();
    requestTick();
  };

  return {
    enqueue(text) {
      if (disposed || !text) return;
      pending.push(...Array.from(text));
      requestTick();
    },
    flush() {
      if (scheduled !== null) {
        cancel(scheduled);
        scheduled = null;
      }
      if (pending.length > 0) {
        write(pending.join(""));
        pending.length = 0;
        onDrain?.();
      }
    },
    dispose() {
      if (disposed) return;
      if (scheduled !== null) cancel(scheduled);
      scheduled = null;
      pending.length = 0;
      disposed = true;
    },
  };
}

/** React binding for the framework-neutral Agent UI store. */
export function useAgentUIState(store: AgentUIStore): AgentUIState {
  return useSyncExternalStore(
    (notify) => store.subscribe(() => notify()),
    store.getSnapshot,
    store.getSnapshot,
  );
}

export interface AgentUIStreamingMarkdownProps {
  store: AgentUIStreamSource;
  turnId: string;
  kind: "assistant" | "thought";
  className?: string;
  prefixSkip?: number;
  paceReplay?: boolean;
  onLinkActivate?: (url: string) => void;
  decorate?: (host: HTMLDivElement) => void;
}

/** Minimal AI-SDK-like stream contract. A host can feed the shared renderer
 * from the canonical Agent UI store or from an existing product transport
 * adapter without exposing that transport to the component. */
export interface AgentUIStreamSource {
  subscribeTurnStream(
    turnId: string,
    listener: AgentUIStreamSubscriber,
  ): () => void;
}

/**
 * The DOM-mutating half of Backchat main's dual-track renderer. React owns
 * one inert host node; the per-turn stream writes markdown directly until the
 * parent swaps this element for its settled renderer.
 */
export function AgentUIStreamingMarkdown({
  store,
  turnId,
  kind,
  className = "",
  prefixSkip = 0,
  paceReplay = false,
  onLinkActivate,
  decorate,
}: AgentUIStreamingMarkdownProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    const parser = smd.parser(smd.default_renderer(host));
    let heldTail: Text | null = null;
    let lastWritten = "";

    const clearTail = () => {
      heldTail?.remove();
      heldTail = null;
    };
    const deepestLast = (node: Element): Element => {
      let current = node;
      while (current.lastElementChild) {
        const next = current.lastElementChild;
        if (next.matches("img, br, hr")) break;
        current = next;
      }
      return current;
    };
    const showTail = () => {
      clearTail();
      const character = Array.from(lastWritten).at(-1);
      if (!character) return;
      heldTail = document.createTextNode(character);
      deepestLast(host).append(heldTail);
    };
    const write = (text: string) => {
      clearTail();
      lastWritten = text;
      smd.parser_write(parser, text);
      decorate?.(host);
    };
    const pacer = createStreamTextPacer({
      write,
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      cancel: (handle) => window.clearTimeout(handle as number),
      onDrain: showTail,
    });

    let subscribing = true;
    const unsubscribe = store.subscribeTurnStream(turnId, (delta) => {
      if (delta.kind !== kind) return;
      let text = delta.text;
      if (subscribing) {
        text = text.slice(prefixSkip);
        if (!text) return;
        if (paceReplay) pacer.enqueue(text);
        else {
          write(text);
          showTail();
        }
        return;
      }
      pacer.enqueue(text);
    });
    subscribing = false;

    const activateLink = (event: MouseEvent) => {
      if (!onLinkActivate) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a") as HTMLAnchorElement | null;
      if (!anchor || !host.contains(anchor)) return;
      const url = (anchor.getAttribute("href") ?? "").trim();
      if (!url) return;
      event.preventDefault();
      event.stopPropagation();
      onLinkActivate(url);
    };
    host.addEventListener("click", activateLink);

    return () => {
      host.removeEventListener("click", activateLink);
      unsubscribe();
      pacer.flush();
      pacer.dispose();
      try {
        smd.parser_end(parser);
      } catch {
        // A partial inline token is discarded with the host during handoff.
      }
    };
  }, [decorate, kind, onLinkActivate, paceReplay, prefixSkip, store, turnId]);

  return (
    <div
      ref={hostRef}
      className={`streaming-md ${className}`.trim()}
      data-agent-ui-streaming-markdown={kind}
    />
  );
}

export function thoughtProjectionLines(text: string, fallback: string): string[] {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [fallback];
}

export function thoughtHeadline(text: string): string {
  let headline = "";
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const heading = trimmed.match(/^#{1,6}\s+(.+?)\s*#*$/)?.[1];
    const bold = trimmed.match(/^(?:\*\*|__)(.+?)(?:\*\*|__)$/)?.[1];
    if (heading || bold) headline = (heading ?? bold)!.trim();
  }
  return headline;
}

const projectionLineText = new WeakMap<HTMLElement, string>();

function syncProjectionLines(host: HTMLSpanElement, lines: string[]): void {
  while (host.children.length > lines.length) {
    host.lastElementChild?.remove();
  }
  lines.forEach((line, index) => {
    let row = host.children.item(index) as HTMLSpanElement | null;
    if (!row) {
      row = document.createElement("span");
      row.dataset.thoughtProjectionLine = "true";
      row.className = "block min-w-0 truncate leading-6";
      host.append(row);
    }
    if (projectionLineText.get(row) !== line) {
      row.replaceChildren();
      const parser = smd.parser(smd.default_renderer(row));
      smd.parser_write(parser, line);
      smd.parser_end(parser);
      // A summary lives inside a disclosure button: keep inline formatting,
      // but leave navigation and block layout to the expanded thought body.
      for (const block of row.querySelectorAll("p, h1, h2, h3, h4, h5, h6, a")) {
        const span = document.createElement("span");
        span.append(...block.childNodes);
        block.replaceWith(span);
      }
      projectionLineText.set(row, line);
    }
  });
}

export function AgentUIStreamingThoughtProjection({
  store,
  turnId,
  prefixSkip,
  fallback,
  mode,
}: {
  store: AgentUIStreamSource;
  turnId: string;
  prefixSkip: number;
  fallback: string;
  mode: "body" | "headline";
}) {
  const hostRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let text = "";
    let replaying = true;
    const render = () => {
      const lines = thoughtProjectionLines(text, fallback);
      if (mode === "headline") {
        host.textContent = thoughtHeadline(text) || lines[0] || fallback;
      } else {
        syncProjectionLines(host, lines);
      }
    };
    const unsubscribe = store.subscribeTurnStream(turnId, (delta) => {
      if (delta.kind !== "thought") return;
      if (replaying) {
        text = delta.text.slice(prefixSkip);
        replaying = false;
      } else {
        text += delta.text;
      }
      render();
    });
    if (replaying) render();
    return unsubscribe;
  }, [fallback, mode, prefixSkip, store, turnId]);

  if (mode === "headline") {
    return <span ref={hostRef}>{fallback}</span>;
  }
  return (
    <span ref={hostRef} className="block min-w-0" data-thought-projection="lines">
      {thoughtProjectionLines(fallback, fallback).map((line, index) => (
        <span
          key={`${index}-${line}`}
          data-thought-projection-line="true"
          className="block min-w-0 truncate leading-6"
        >
          {line}
        </span>
      ))}
    </span>
  );
}
