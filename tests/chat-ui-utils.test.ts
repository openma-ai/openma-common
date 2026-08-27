import { afterEach, describe, expect, it, vi } from "vitest";

import { preserveChatScrollAnchor } from "../src/chat-ui/utils.js";

describe("chat disclosure scroll anchoring", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not let a stale disclosure observer undo a newer toggle", () => {
    const resizeCallbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.push(callback);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );

    let contentTop = 100;
    const scheduled: Array<() => void> = [];
    const scrollElement = {
      scrollTop: 100,
      scrollHeight: 1_000,
      clientHeight: 400,
      addEventListener() {},
      removeEventListener() {},
    };
    const anchorElement = {
      getBoundingClientRect: () =>
        ({ top: contentTop - scrollElement.scrollTop }) as DOMRect,
    };
    const contentElement = { style: { paddingBottom: "" } } as HTMLElement;
    const scheduleFrame = (callback: () => void) => scheduled.push(callback);
    const runScheduledFrames = () => {
      while (scheduled.length > 0) scheduled.shift()?.();
    };

    preserveChatScrollAnchor({
      scrollElement,
      anchorElement,
      contentElement,
      update: () => {
        contentTop = 120;
      },
      stopScroll: () => {},
      scheduleFrame,
    });
    preserveChatScrollAnchor({
      scrollElement,
      anchorElement,
      contentElement,
      update: () => {
        contentTop = 100;
      },
      stopScroll: () => {},
      scheduleFrame,
    });
    runScheduledFrames();

    expect(anchorElement.getBoundingClientRect().top).toBe(20);

    resizeCallbacks[0]?.([], {} as ResizeObserver);
    runScheduledFrames();

    expect(anchorElement.getBoundingClientRect().top).toBe(20);
  });
});
