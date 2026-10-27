import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export function chatClassNames(...inputs) {
    return twMerge(clsx(inputs));
}
/** Matches use-stick-to-bottom's STICK_TO_BOTTOM_OFFSET_PX. */
const STICK_NEAR_BOTTOM_OFFSET_PX = 70;
export const SCROLL_ANCHOR_ESCAPE_BUFFER_PX = STICK_NEAR_BOTTOM_OFFSET_PX + 1;
const activeScrollAnchorSlack = new WeakMap();
const activeAnchorSessions = new WeakMap();
let scrollAnchorGeneration = 0;
function totalSlack(state) {
    return Math.max(0, state.contentNeeded) + Math.max(0, state.escapeBuffer);
}
function readBasePadding(contentElement) {
    try {
        if (typeof getComputedStyle === "function") {
            return (Number.parseFloat(getComputedStyle(contentElement).paddingBottom) || 0);
        }
    }
    catch {
        // jsdom / test doubles may lack getComputedStyle.
    }
    return Number.parseFloat(contentElement.style.paddingBottom || "0") || 0;
}
function setScrollAnchorSlack(state) {
    const slack = totalSlack(state);
    if (slack <= 0.5) {
        state.contentElement.style.paddingBottom = state.originalInlinePadding;
        state.scrollElement.removeEventListener("scroll", state.onScroll);
        activeScrollAnchorSlack.delete(state.contentElement);
        return;
    }
    state.contentElement.style.paddingBottom = `${state.basePadding + slack}px`;
}
function reconcileScrollAnchorSlack(state) {
    const slack = totalSlack(state);
    const realMaxScrollTop = state.scrollElement.scrollHeight -
        state.scrollElement.clientHeight -
        slack;
    const contentNeeded = Math.max(0, state.scrollElement.scrollTop - realMaxScrollTop);
    const desiredTotal = contentNeeded + state.escapeBuffer;
    if (Math.abs(desiredTotal - slack) > 0.5) {
        state.contentNeeded = contentNeeded;
        setScrollAnchorSlack(state);
    }
}
function endScrollAnchorSession(contentElement, generation) {
    const session = activeAnchorSessions.get(contentElement);
    if (!session || session.generation !== generation)
        return;
    session.observer?.disconnect();
    session.observer = null;
    if (session.timer != null) {
        clearTimeout(session.timer);
        session.timer = null;
    }
    activeAnchorSessions.delete(contentElement);
    const slackState = activeScrollAnchorSlack.get(contentElement);
    if (slackState && slackState.escapeBuffer > 0) {
        // scrollHeight still includes the applied (contentNeeded + escapeBuffer)
        // padding. Derive contentNeeded from that applied total before clearing
        // the buffer, otherwise reconcile under-counts and drops needed slack.
        const applied = totalSlack(slackState);
        const realMaxScrollTop = slackState.scrollElement.scrollHeight -
            slackState.scrollElement.clientHeight -
            applied;
        slackState.contentNeeded = Math.max(0, slackState.scrollElement.scrollTop - realMaxScrollTop);
        slackState.escapeBuffer = 0;
        setScrollAnchorSlack(slackState);
    }
}
function ensureSlackState(scrollElement, contentElement) {
    if (!contentElement.style)
        return null;
    let state = activeScrollAnchorSlack.get(contentElement);
    if (!state) {
        const originalInlinePadding = contentElement.style.paddingBottom;
        state = {
            scrollElement,
            contentElement,
            basePadding: readBasePadding(contentElement),
            originalInlinePadding,
            contentNeeded: 0,
            escapeBuffer: 0,
            onScroll: () => { },
        };
        state.onScroll = () => reconcileScrollAnchorSlack(state);
        scrollElement.addEventListener("scroll", state.onScroll, { passive: true });
        activeScrollAnchorSlack.set(contentElement, state);
    }
    return state;
}
function addScrollAnchorSlack(scrollElement, contentElement, missingScrollRange, withEscapeBuffer) {
    const state = ensureSlackState(scrollElement, contentElement);
    if (!state)
        return;
    state.contentNeeded = Math.max(0, state.contentNeeded + missingScrollRange);
    if (withEscapeBuffer) {
        state.escapeBuffer = SCROLL_ANCHOR_ESCAPE_BUFFER_PX;
    }
    setScrollAnchorSlack(state);
}
function distanceToBottom(scrollElement) {
    if (typeof scrollElement.scrollHeight !== "number" ||
        typeof scrollElement.clientHeight !== "number") {
        return Number.POSITIVE_INFINITY;
    }
    return (scrollElement.scrollHeight -
        scrollElement.clientHeight -
        scrollElement.scrollTop);
}
/** Keep a disclosure trigger at the same viewport Y while its content changes.
 * Counters bottom-pinned chat scrollers reflowing when a block near the
 * composer expands or collapses (Backchat issue #103 stick-to-bottom fight). */
export function preserveChatScrollAnchor({ scrollElement, anchorElement, contentElement, update, stopScroll, scheduleFrame = (callback) => requestAnimationFrame(callback), }) {
    if (!scrollElement || !anchorElement) {
        update();
        return;
    }
    const generation = ++scrollAnchorGeneration;
    if (contentElement) {
        const previous = activeAnchorSessions.get(contentElement);
        if (previous) {
            previous.observer?.disconnect();
            if (previous.timer != null)
                clearTimeout(previous.timer);
        }
        activeAnchorSessions.set(contentElement, {
            generation,
            observer: null,
            timer: null,
        });
    }
    stopScroll();
    const before = anchorElement.getBoundingClientRect().top;
    const reanchor = () => {
        if (contentElement) {
            const session = activeAnchorSessions.get(contentElement);
            if (!session || session.generation !== generation)
                return;
        }
        stopScroll();
        const delta = anchorElement.getBoundingClientRect().top - before;
        if (Math.abs(delta) > 0.5) {
            scrollElement.scrollTop += delta;
            const remaining = anchorElement.getBoundingClientRect().top - before;
            if (remaining > 0.5 && contentElement) {
                addScrollAnchorSlack(scrollElement, contentElement, remaining, true);
                scrollElement.scrollTop += remaining;
            }
            else if (contentElement &&
                distanceToBottom(scrollElement) <= STICK_NEAR_BOTTOM_OFFSET_PX) {
                // Scroll range covered the delta, but we are still inside stick-to-
                // bottom's near-bottom band — hold escape buffer so a negative resize
                // cannot re-lock isAtBottom during the collapse animation.
                addScrollAnchorSlack(scrollElement, contentElement, 0, true);
            }
        }
        else if (contentElement &&
            distanceToBottom(scrollElement) <= STICK_NEAR_BOTTOM_OFFSET_PX) {
            addScrollAnchorSlack(scrollElement, contentElement, 0, true);
        }
        stopScroll();
        const slackState = contentElement
            ? activeScrollAnchorSlack.get(contentElement)
            : undefined;
        if (slackState)
            reconcileScrollAnchorSlack(slackState);
    };
    if (contentElement && typeof ResizeObserver !== "undefined") {
        const session = activeAnchorSessions.get(contentElement);
        const observer = new ResizeObserver(() => scheduleFrame(() => {
            const current = activeAnchorSessions.get(contentElement);
            if (!current || current.generation !== generation)
                return;
            stopScroll();
            reanchor();
        }));
        observer.observe(contentElement);
        session.observer = observer;
        session.timer = setTimeout(() => {
            endScrollAnchorSession(contentElement, generation);
        }, 400);
    }
    update();
    scheduleFrame(reanchor);
}
//# sourceMappingURL=utils.js.map