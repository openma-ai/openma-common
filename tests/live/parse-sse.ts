/**
 * Parser for `GET /v1/agents/{id}/runs/{runId}/stream` (`text/event-stream`).
 *
 * Field rules follow the SSE spec and the Cloud Agents API example at
 * https://cursor.com/docs/cloud-agent/api/endpoints. `id` is an opaque
 * resume cursor. A missing `event` name becomes the SSE default `message`.
 */
import type { CursorCloudSseEvent } from "../../src/protocol/cursor-cloud/index.js";

export function parseSseFrame(raw: string): CursorCloudSseEvent | undefined {
  let eventName: string | undefined;
  let id: string | undefined;
  const dataLines: string[] = [];
  let sawDispatchField = false;

  for (const line of raw.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") {
      eventName = value;
      sawDispatchField = true;
    } else if (field === "id") {
      // An empty id resets the Last-Event-ID. Do not resume from it.
      if (value.length > 0) id = value;
      sawDispatchField = true;
    } else if (field === "data") {
      dataLines.push(value);
      sawDispatchField = true;
    }
  }

  if (!sawDispatchField) return undefined;
  const dataText = dataLines.join("\n");
  return {
    event: eventName && eventName.length > 0 ? eventName : "message",
    ...(id ? { id } : {}),
    data: parseData(dataText),
  };
}

export async function* readSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<CursorCloudSseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const frames = takeFrames(buffer);
      buffer = frames.rest;
      for (const frame of frames.events) yield frame;
    }
  } finally {
    reader.releaseLock();
  }
  buffer += decoder.decode();
  buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (buffer.trim().length > 0) {
    const trailing = parseSseFrame(buffer);
    if (trailing) yield trailing;
  }
}

function takeFrames(buffer: string): { events: CursorCloudSseEvent[]; rest: string } {
  const events: CursorCloudSseEvent[] = [];
  let rest = buffer;
  let splitAt = rest.indexOf("\n\n");
  while (splitAt !== -1) {
    const parsed = parseSseFrame(rest.slice(0, splitAt));
    if (parsed) events.push(parsed);
    rest = rest.slice(splitAt + 2);
    splitAt = rest.indexOf("\n\n");
  }
  return { events, rest };
}

function parseData(dataText: string): unknown {
  if (dataText.length === 0) return "";
  try {
    return JSON.parse(dataText) as unknown;
  } catch {
    return dataText;
  }
}
