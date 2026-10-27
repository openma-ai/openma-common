import { afterEach, describe, expect, it, vi } from "vitest";

import {
  preserveChatScrollAnchor,
  SCROLL_ANCHOR_ESCAPE_BUFFER_PX,
} from "../src/chat-ui/utils.js";

describe("chat disclosure scroll anchoring", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does not let a stale disclosure observer undo a newer toggle", () => {
    const resizeCallbacks: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        #callback: () => void;
        constructor(callback: ResizeObserverCallback) {
          this.#callback = () => callback([], this);
          resizeCallbacks.push(this.#callback);
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

    resizeCallbacks[0]?.();
    runScheduledFrames();

    expect(anchorElement.getBoundingClientRect().top).toBe(20);
  });

  it("holds an escape buffer past stick-to-bottom's near-bottom band", () => {
    const frames: Array<() => void> = [];
    let baseMaxScrollTop = 240;
    let bottomSlack = 0;
    let currentScrollTop = 240;
    let inlinePaddingBottom = "";
    const scrollElement = {
      clientHeight: 600,
      get scrollHeight() {
        return 600 + baseMaxScrollTop + bottomSlack;
      },
      get scrollTop() {
        return currentScrollTop;
      },
      set scrollTop(value: number) {
        currentScrollTop = Math.max(
          0,
          Math.min(value, baseMaxScrollTop + bottomSlack),
        );
      },
      addEventListener() {},
      removeEventListener() {},
    };
    const contentElement = {
      style: {
        get paddingBottom() {
          return inlinePaddingBottom;
        },
        set paddingBottom(value: string) {
          inlinePaddingBottom = value;
          bottomSlack = Math.max(0, Number.parseFloat(value || "24") - 24);
        },
      },
    } as unknown as HTMLElement;
    vi.stubGlobal("getComputedStyle", () => ({ paddingBottom: "24px" }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );

    preserveChatScrollAnchor({
      scrollElement,
      anchorElement: {
        getBoundingClientRect: () => ({ top: 360 - currentScrollTop }),
      },
      contentElement,
      update: () => {
        baseMaxScrollTop = 180;
        scrollElement.scrollTop = currentScrollTop;
      },
      stopScroll: () => {},
      scheduleFrame: (callback) => frames.push(callback),
    });
    frames.shift()!();

    expect(bottomSlack).toBe(60 + SCROLL_ANCHOR_ESCAPE_BUFFER_PX);
    expect(
      scrollElement.scrollHeight - scrollElement.clientHeight - currentScrollTop,
    ).toBeGreaterThan(70);
  });

  it("clears the escape buffer when the preserve session ends", () => {
    vi.useFakeTimers();
    const frames: Array<() => void> = [];
    let baseMaxScrollTop = 240;
    let bottomSlack = 0;
    let currentScrollTop = 240;
    let inlinePaddingBottom = "";
    const scrollElement = {
      clientHeight: 600,
      get scrollHeight() {
        return 600 + baseMaxScrollTop + bottomSlack;
      },
      get scrollTop() {
        return currentScrollTop;
      },
      set scrollTop(value: number) {
        currentScrollTop = Math.max(
          0,
          Math.min(value, baseMaxScrollTop + bottomSlack),
        );
      },
      addEventListener() {},
      removeEventListener() {},
    };
    const contentElement = {
      style: {
        get paddingBottom() {
          return inlinePaddingBottom;
        },
        set paddingBottom(value: string) {
          inlinePaddingBottom = value;
          bottomSlack = Math.max(0, Number.parseFloat(value || "24") - 24);
        },
      },
    } as unknown as HTMLElement;
    vi.stubGlobal("getComputedStyle", () => ({ paddingBottom: "24px" }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );

    preserveChatScrollAnchor({
      scrollElement,
      anchorElement: {
        getBoundingClientRect: () => ({ top: 360 - currentScrollTop }),
      },
      contentElement,
      update: () => {
        baseMaxScrollTop = 180;
        scrollElement.scrollTop = currentScrollTop;
      },
      stopScroll: () => {},
      scheduleFrame: (callback) => frames.push(callback),
    });
    frames.shift()!();
    expect(bottomSlack).toBe(60 + SCROLL_ANCHOR_ESCAPE_BUFFER_PX);

    vi.advanceTimersByTime(400);
    expect(bottomSlack).toBe(60);
    expect(currentScrollTop).toBe(240);
  });
});
