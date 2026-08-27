import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function chatClassNames(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

type ScrollAnchorOptions = {
  scrollElement:
    | Pick<
        HTMLElement,
        | "scrollTop"
        | "scrollHeight"
        | "clientHeight"
        | "addEventListener"
        | "removeEventListener"
      >
    | null;
  anchorElement: Pick<HTMLElement, "getBoundingClientRect"> | null;
  contentElement?: HTMLElement | null;
  update: () => void;
  stopScroll: () => void;
  scheduleFrame?: (callback: () => void) => void;
};

type ScrollAnchorSlack = {
  scrollElement: NonNullable<ScrollAnchorOptions["scrollElement"]>;
  contentElement: NonNullable<ScrollAnchorOptions["contentElement"]>;
  basePadding: number;
  originalInlinePadding: string;
  slack: number;
  onScroll: () => void;
};

const activeScrollAnchorSlack = new WeakMap<object, ScrollAnchorSlack>();

function setScrollAnchorSlack(state: ScrollAnchorSlack, slack: number): void {
  state.slack = Math.max(0, slack);
  if (state.slack <= 0.5) {
    state.contentElement.style.paddingBottom = state.originalInlinePadding;
    state.scrollElement.removeEventListener("scroll", state.onScroll);
    activeScrollAnchorSlack.delete(state.contentElement);
    return;
  }
  state.contentElement.style.paddingBottom = `${state.basePadding + state.slack}px`;
}

function reconcileScrollAnchorSlack(state: ScrollAnchorSlack): void {
  const realMaxScrollTop =
    state.scrollElement.scrollHeight -
    state.scrollElement.clientHeight -
    state.slack;
  const stillNeeded = Math.max(
    0,
    state.scrollElement.scrollTop - realMaxScrollTop,
  );
  if (stillNeeded < state.slack - 0.5) {
    setScrollAnchorSlack(state, stillNeeded);
  }
}

function addScrollAnchorSlack(
  scrollElement: NonNullable<ScrollAnchorOptions["scrollElement"]>,
  contentElement: NonNullable<ScrollAnchorOptions["contentElement"]>,
  missingScrollRange: number,
): void {
  let state = activeScrollAnchorSlack.get(contentElement);
  if (!state) {
    const originalInlinePadding = contentElement.style.paddingBottom;
    state = {
      scrollElement,
      contentElement,
      basePadding:
        Number.parseFloat(getComputedStyle(contentElement).paddingBottom) || 0,
      originalInlinePadding,
      slack: 0,
      onScroll: () => {},
    };
    state.onScroll = () => reconcileScrollAnchorSlack(state!);
    scrollElement.addEventListener("scroll", state.onScroll, { passive: true });
    activeScrollAnchorSlack.set(contentElement, state);
  }

  setScrollAnchorSlack(state, state.slack + missingScrollRange);
}

/** Backchat's scroll-anchor preservation for nested process disclosures. */
export function preserveChatScrollAnchor({
  scrollElement,
  anchorElement,
  contentElement,
  update,
  stopScroll,
  scheduleFrame = (callback) => requestAnimationFrame(callback),
}: ScrollAnchorOptions): void {
  if (!scrollElement || !anchorElement) {
    update();
    return;
  }

  stopScroll();
  const before = anchorElement.getBoundingClientRect().top;
  const reanchor = () => {
    const delta = anchorElement.getBoundingClientRect().top - before;
    if (Math.abs(delta) > 0.5) {
      scrollElement.scrollTop += delta;
      const remaining = anchorElement.getBoundingClientRect().top - before;
      if (remaining > 0.5 && contentElement) {
        addScrollAnchorSlack(scrollElement, contentElement, remaining);
        scrollElement.scrollTop += remaining;
      }
    }
    const slackState = contentElement
      ? activeScrollAnchorSlack.get(contentElement)
      : undefined;
    if (slackState) reconcileScrollAnchorSlack(slackState);
  };
  update();
  scheduleFrame(reanchor);
}
