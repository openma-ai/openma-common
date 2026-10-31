/**
 * A prompt that has been accepted by the host but has not started running yet.
 * The field names intentionally match Backchat's queue model where possible;
 * `createdAt` is optional because a host may not expose a timestamp.
 */
export interface QueuedPrompt {
    id: string;
    text: string;
    createdAt?: number;
    /** Host-side work in flight for this row (sending, removing, steering):
     * its controls are disabled and it is marked aria-busy. */
    busy?: boolean;
}
/** Optional host actions. A control is rendered only when its callback exists. */
export interface QueueDockCallbacks {
    update?(id: string, text: string): void | Promise<void>;
    remove?(id: string): void | Promise<void>;
    reorder?(ids: string[]): void | Promise<void>;
    steer?(id: string): void | Promise<void>;
}
export type QueueDockLabelResolver<TArgs extends readonly unknown[] = []> = string | ((...args: TArgs) => string);
/**
 * Every visible and accessible string in the dock. Indexes are zero-based;
 * the English defaults add one so the rendered copy stays human-readable.
 */
export interface QueueDockLabels {
    /** Accessible name for the queue list, e.g. "3 queued". */
    title?: QueueDockLabelResolver<[count: number]>;
    /** Accessible name for the edit textarea. */
    prompt?: QueueDockLabelResolver<[index: number]>;
    /** Accessible name for the edit button. */
    edit?: QueueDockLabelResolver<[index: number]>;
    save?: QueueDockLabelResolver<[]>;
    cancel?: QueueDockLabelResolver<[]>;
    remove?: QueueDockLabelResolver<[index: number]>;
    moveUp?: QueueDockLabelResolver<[index: number]>;
    moveDown?: QueueDockLabelResolver<[index: number]>;
    dragHandle?: QueueDockLabelResolver<[index: number]>;
    /** Visible steer action, shown on the row. */
    steer?: QueueDockLabelResolver<[index: number]>;
    /** Accessible name for the steer action. */
    steerQueued?: QueueDockLabelResolver<[index: number]>;
    /** Text for the blocked header. `blockedOn` is accepted as an alias. */
    blocked?: QueueDockLabelResolver<[count: number, toolNames: string[]]>;
    blockedOn?: QueueDockLabelResolver<[count: number, toolNames: string[]]>;
    /** Visible label and accessible name for the interrupt button. */
    interrupt?: QueueDockLabelResolver<[blocked: QueueDockBlocked]>;
}
/**
 * The host is paused on a tool call. The queue can still be rendered, but the
 * host may offer an interrupt action to release it.
 */
export interface QueueDockBlocked {
    reason: "requires_action";
    toolNames?: string[];
    toolCallIds?: string[];
    onInterrupt?: () => void | Promise<void>;
}
export declare const defaultQueueDockLabels: {
    title: (count: number) => string;
    prompt: (index: number) => string;
    edit: (index: number) => string;
    save: string;
    cancel: string;
    remove: (index: number) => string;
    moveUp: (index: number) => string;
    moveDown: (index: number) => string;
    dragHandle: (index: number) => string;
    steer: string;
    steerQueued: (index: number) => string;
    blocked: (count: number, toolNames: string[]) => string;
    blockedOn: (count: number, toolNames: string[]) => string;
    interrupt: string;
};
export interface QueueDockProps {
    prompts: QueuedPrompt[];
    callbacks?: QueueDockCallbacks;
    labels?: Partial<QueueDockLabels>;
    blocked?: QueueDockBlocked;
    className?: string;
    disabled?: boolean;
}
/**
 * Host-agnostic queued-prompt dock. It owns presentation and interaction
 * state only; every side effect is supplied by the host through callbacks.
 */
export declare function QueueDock({ prompts, callbacks, labels, blocked, className, disabled, }: QueueDockProps): import("react").JSX.Element | null;
//# sourceMappingURL=queue-dock.d.ts.map