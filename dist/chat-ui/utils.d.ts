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
/** Backchat's scroll-anchor preservation for nested process disclosures. */
export declare function preserveChatScrollAnchor({ scrollElement, anchorElement, contentElement, update, stopScroll, scheduleFrame, }: ScrollAnchorOptions): void;
export {};
//# sourceMappingURL=utils.d.ts.map