import { type ClassValue } from "clsx";
export declare function chatClassNames(...inputs: ClassValue[]): string;
type ScrollAnchorOptions = {
    scrollElement: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight" | "addEventListener" | "removeEventListener"> | null;
    anchorElement: Pick<HTMLElement, "getBoundingClientRect"> | null;
    contentElement?: HTMLElement | null;
    update: () => void;
    stopScroll: () => void;
    scheduleFrame?: (callback: () => void) => void;
};
export declare const SCROLL_ANCHOR_ESCAPE_BUFFER_PX: number;
/** Keep a disclosure trigger at the same viewport Y while its content changes.
 * Counters bottom-pinned chat scrollers reflowing when a block near the
 * composer expands or collapses (Backchat issue #103 stick-to-bottom fight). */
export declare function preserveChatScrollAnchor({ scrollElement, anchorElement, contentElement, update, stopScroll, scheduleFrame, }: ScrollAnchorOptions): void;
export {};
//# sourceMappingURL=utils.d.ts.map