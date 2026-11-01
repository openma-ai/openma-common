"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState, } from "react";
export const defaultQueueDockLabels = {
    title: (count) => `${count} queued`,
    prompt: (index) => `Queued message ${index + 1}`,
    edit: (index) => `Edit queued message ${index + 1}`,
    save: "Save",
    cancel: "Cancel",
    remove: (index) => `Remove queued message ${index + 1}`,
    moveUp: (index) => `Move queued message ${index + 1} up`,
    moveDown: (index) => `Move queued message ${index + 1} down`,
    dragHandle: (index) => `Drag queued message ${index + 1}`,
    steer: "Send now",
    steerQueued: (index) => `Steer queued message ${index + 1}`,
    blocked: (count, toolNames) => toolNames.length > 0
        ? `${count} queued · waiting on tool ${toolNames.join(", ")}`
        : `${count} queued · waiting on tool`,
    blockedOn: (count, toolNames) => toolNames.length > 0
        ? `${count} queued · waiting on tool ${toolNames.join(", ")}`
        : `${count} queued · waiting on tool`,
    interrupt: "Interrupt",
};
function resolveLabel(override, fallback, ...args) {
    const label = override ?? fallback;
    return typeof label === "function" ? label(...args) : label;
}
function nonEmptyToolNames(blocked) {
    return (blocked.toolNames ?? []).filter((name) => name.trim().length > 0);
}
function asPromise(action) {
    try {
        return Promise.resolve(action());
    }
    catch (error) {
        return Promise.reject(error);
    }
}
/**
 * Host-agnostic queued-prompt dock. It owns presentation and interaction
 * state only; every side effect is supplied by the host through callbacks.
 */
export function QueueDock({ prompts, callbacks, labels, blocked, className, disabled = false, }) {
    const [draggingId, setDraggingId] = useState(null);
    if (prompts.length === 0 && !blocked)
        return null;
    const title = resolveLabel(labels?.title, defaultQueueDockLabels.title, prompts.length);
    const rootClassName = [
        "oma-queue-dock",
        disabled ? "oma-queue-dock--disabled" : undefined,
        className,
    ]
        .filter(Boolean)
        .join(" ");
    return (_jsxs("div", { className: rootClassName, "data-queue-dock": "true", "data-composer-progress": "true", "data-queue-dock-disabled": disabled ? "true" : undefined, children: [blocked ? (_jsx(QueueDockBlockedLine, { blocked: blocked, count: prompts.length, labels: labels, disabled: disabled })) : null, prompts.length > 0 ? (_jsx("div", { className: "oma-queue-dock__viewport", "data-progress-cap-viewport": "true", children: _jsx("div", { className: "oma-queue-dock__banner", "data-progress-banner": "true", children: _jsx("div", { className: "oma-queue-dock__list", "data-composer-queue": "true", role: "list", "aria-label": title, children: prompts.map((prompt, index) => (_jsx(QueueDockRow, { prompt: prompt, index: index, prompts: prompts, callbacks: callbacks, labels: labels, disabled: disabled, draggingId: draggingId, onDragStart: setDraggingId, onDragEnd: () => setDraggingId(null) }, prompt.id))) }) }) })) : null] }));
}
function QueueDockBlockedLine({ blocked, count, labels, disabled, }) {
    const [pending, setPending] = useState(false);
    const toolNames = nonEmptyToolNames(blocked);
    const text = resolveLabel(labels?.blockedOn ?? labels?.blocked, defaultQueueDockLabels.blocked, count, toolNames);
    const interruptLabel = resolveLabel(labels?.interrupt, defaultQueueDockLabels.interrupt, blocked);
    const canInterrupt = Boolean(blocked.onInterrupt);
    const interrupt = async () => {
        if (!blocked.onInterrupt || disabled || pending)
            return;
        setPending(true);
        try {
            await asPromise(blocked.onInterrupt);
        }
        catch {
            // The host owns error presentation; the dock only resets its own state.
        }
        finally {
            setPending(false);
        }
    };
    return (_jsxs("div", { className: "oma-queue-dock__blocked", "data-queue-blocked": blocked.reason, role: "status", children: [_jsx(ClockIcon, { className: "oma-queue-dock__icon oma-queue-dock__blocked-icon lucide-clock" }), _jsx("span", { className: "oma-queue-dock__blocked-text", children: text }), canInterrupt ? (_jsxs("button", { type: "button", className: "oma-queue-dock__button oma-queue-dock__button--interrupt", "data-queue-interrupt": "true", disabled: disabled || pending, "aria-label": interruptLabel, title: interruptLabel, onClick: () => {
                    void interrupt();
                }, children: [_jsx(CirclePauseIcon, { className: "oma-queue-dock__icon lucide-circle-pause" }), _jsx("span", { children: interruptLabel })] })) : null] }));
}
function QueueDockRow({ prompt, index, prompts, callbacks, labels, disabled, draggingId, onDragStart, onDragEnd, }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(prompt.text);
    const [pending, setPending] = useState(false);
    useEffect(() => {
        if (!editing)
            setDraft(prompt.text);
    }, [editing, prompt.text]);
    const controlsDisabled = disabled || pending || prompt.busy === true;
    const reorder = callbacks?.reorder;
    const canReorder = Boolean(reorder) && !controlsDisabled && !editing;
    const isFirst = index === 0;
    const isLast = index === prompts.length - 1;
    const steerText = resolveLabel(labels?.steer, defaultQueueDockLabels.steer, index);
    // A host that overrides only the visible steer label still gets a matching
    // accessible name; the default keeps Backchat's "Steer queued message N".
    const steerAria = labels?.steerQueued
        ? resolveLabel(labels.steerQueued, defaultQueueDockLabels.steerQueued, index)
        : labels?.steer
            ? `${steerText} ${index + 1}`
            : resolveLabel(undefined, defaultQueueDockLabels.steerQueued, index);
    const run = async (action) => {
        if (pending)
            return;
        setPending(true);
        try {
            await asPromise(action);
        }
        catch {
            // The host owns error presentation; the dock only resets its own state.
        }
        finally {
            setPending(false);
        }
    };
    const move = (offset) => {
        if (!reorder || controlsDisabled)
            return;
        const targetIndex = index + offset;
        if (targetIndex < 0 || targetIndex >= prompts.length)
            return;
        const ids = prompts.map((entry) => entry.id);
        const current = ids[index];
        const target = ids[targetIndex];
        if (!current || !target)
            return;
        ids[index] = target;
        ids[targetIndex] = current;
        void run(() => reorder(ids));
    };
    const save = async (event) => {
        event?.preventDefault();
        const text = draft.trim();
        if (!text || !callbacks?.update || controlsDisabled)
            return;
        setPending(true);
        try {
            await asPromise(() => callbacks.update?.(prompt.id, text) ?? undefined);
            setEditing(false);
        }
        catch {
            // Keep the draft open so the host can retry without losing the edit.
        }
        finally {
            setPending(false);
        }
    };
    const startEdit = () => {
        if (!callbacks?.update || controlsDisabled)
            return;
        setDraft(prompt.text);
        setEditing(true);
    };
    const cancelEdit = () => {
        if (pending)
            return;
        setDraft(prompt.text);
        setEditing(false);
    };
    const remove = () => {
        if (!callbacks?.remove || controlsDisabled)
            return;
        void run(() => callbacks.remove?.(prompt.id) ?? undefined);
    };
    const steer = () => {
        if (!callbacks?.steer || controlsDisabled)
            return;
        void run(() => callbacks.steer?.(prompt.id) ?? undefined);
    };
    const handleDragStart = (event) => {
        if (!canReorder) {
            event.preventDefault();
            return;
        }
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("application/x-oma-queue-prompt", prompt.id);
            event.dataTransfer.setData("text/plain", prompt.id);
        }
        onDragStart(prompt.id);
    };
    const handleDragOver = (event) => {
        if (!canReorder)
            return;
        event.preventDefault();
        if (event.dataTransfer)
            event.dataTransfer.dropEffect = "move";
    };
    const handleDrop = (event) => {
        if (!reorder || controlsDisabled)
            return;
        event.preventDefault();
        const sourceId = draggingId ||
            event.dataTransfer?.getData("application/x-oma-queue-prompt") ||
            event.dataTransfer?.getData("text/plain");
        if (!sourceId || sourceId === prompt.id)
            return;
        const from = prompts.findIndex((entry) => entry.id === sourceId);
        if (from < 0 || from === index)
            return;
        const ids = prompts.map((entry) => entry.id);
        const [moved] = ids.splice(from, 1);
        if (!moved)
            return;
        ids.splice(index, 0, moved);
        void run(() => reorder(ids));
    };
    return (_jsxs("div", { className: [
            "oma-queue-dock__row",
            editing ? "oma-queue-dock__row--editing" : undefined,
            pending ? "oma-queue-dock__row--pending" : undefined,
        ]
            .filter(Boolean)
            .join(" "), "data-queued-prompt-id": prompt.id, "data-queued-turn-id": prompt.id, "data-queue-dragging": draggingId === prompt.id ? "true" : undefined, "data-queue-row-disabled": disabled ? "true" : undefined, role: "listitem", "aria-busy": pending || prompt.busy || undefined, draggable: canReorder, onDragStart: handleDragStart, onDragOver: handleDragOver, onDrop: handleDrop, onDragEnd: onDragEnd, children: [reorder ? (_jsx("span", { className: "oma-queue-dock__drag", "data-queue-leading-icon": "drag", role: "img", "aria-label": resolveLabel(labels?.dragHandle, defaultQueueDockLabels.dragHandle, index), title: resolveLabel(labels?.dragHandle, defaultQueueDockLabels.dragHandle, index), children: _jsx(GripVerticalIcon, { className: "oma-queue-dock__icon lucide-grip-vertical" }) })) : null, editing ? (_jsxs("form", { className: "oma-queue-dock__edit", onSubmit: (event) => {
                    void save(event);
                }, children: [_jsx("textarea", { autoFocus: true, rows: 1, value: draft, disabled: disabled || pending, "aria-label": resolveLabel(labels?.prompt, defaultQueueDockLabels.prompt, index), className: "oma-queue-dock__textarea", onChange: (event) => setDraft(event.target.value), onKeyDown: (event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault();
                                void save();
                            }
                            else if (event.key === "Escape") {
                                event.preventDefault();
                                cancelEdit();
                            }
                        } }), _jsx("button", { type: "submit", className: "oma-queue-dock__button oma-queue-dock__button--text", disabled: !draft.trim() || controlsDisabled, children: resolveLabel(labels?.save, defaultQueueDockLabels.save) }), _jsx("button", { type: "button", className: "oma-queue-dock__button oma-queue-dock__button--text", disabled: controlsDisabled, onClick: cancelEdit, children: resolveLabel(labels?.cancel, defaultQueueDockLabels.cancel) })] })) : (_jsx("span", { className: "oma-queue-dock__text", title: prompt.text, children: prompt.text })), !editing ? (_jsxs(_Fragment, { children: [reorder ? (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "oma-queue-dock__button oma-queue-dock__button--icon", "data-queue-move": "up", disabled: controlsDisabled || isFirst, "aria-label": resolveLabel(labels?.moveUp, defaultQueueDockLabels.moveUp, index), title: resolveLabel(labels?.moveUp, defaultQueueDockLabels.moveUp, index), onClick: () => move(-1), children: _jsx(ArrowUpIcon, { className: "oma-queue-dock__icon lucide-arrow-up" }) }), _jsx("button", { type: "button", className: "oma-queue-dock__button oma-queue-dock__button--icon", "data-queue-move": "down", disabled: controlsDisabled || isLast, "aria-label": resolveLabel(labels?.moveDown, defaultQueueDockLabels.moveDown, index), title: resolveLabel(labels?.moveDown, defaultQueueDockLabels.moveDown, index), onClick: () => move(1), children: _jsx(ArrowDownIcon, { className: "oma-queue-dock__icon lucide-arrow-down" }) })] })) : null, callbacks?.steer ? (_jsxs("button", { type: "button", className: "oma-queue-dock__button oma-queue-dock__button--steer", "data-queue-steer": "true", disabled: controlsDisabled, "aria-label": steerAria, title: steerAria, onClick: steer, children: [_jsx(SendHorizontalIcon, { className: "oma-queue-dock__icon lucide-send-horizontal" }), _jsx("span", { children: steerText })] })) : null, callbacks?.update ? (_jsx("button", { type: "button", className: "oma-queue-dock__button oma-queue-dock__button--icon", disabled: controlsDisabled, "aria-label": resolveLabel(labels?.edit, defaultQueueDockLabels.edit, index), title: resolveLabel(labels?.edit, defaultQueueDockLabels.edit, index), onClick: startEdit, children: _jsx(PencilIcon, { className: "oma-queue-dock__icon lucide-pencil" }) })) : null, callbacks?.remove ? (_jsx("button", { type: "button", className: "oma-queue-dock__button oma-queue-dock__button--icon oma-queue-dock__button--danger", disabled: controlsDisabled, "aria-label": resolveLabel(labels?.remove, defaultQueueDockLabels.remove, index), title: resolveLabel(labels?.remove, defaultQueueDockLabels.remove, index), onClick: remove, children: _jsx(Trash2Icon, { className: "oma-queue-dock__icon lucide-trash-2" }) })) : null] })) : null] }));
}
function GripVerticalIcon({ className }) {
    return (_jsxs("svg", { className: className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false", children: [_jsx("circle", { cx: "9", cy: "12", r: "1" }), _jsx("circle", { cx: "9", cy: "5", r: "1" }), _jsx("circle", { cx: "9", cy: "19", r: "1" }), _jsx("circle", { cx: "15", cy: "12", r: "1" }), _jsx("circle", { cx: "15", cy: "5", r: "1" }), _jsx("circle", { cx: "15", cy: "19", r: "1" })] }));
}
function ArrowUpIcon({ className }) {
    return (_jsxs("svg", { className: className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false", children: [_jsx("path", { d: "m5 12 7-7 7 7" }), _jsx("path", { d: "M12 19V5" })] }));
}
function ArrowDownIcon({ className }) {
    return (_jsxs("svg", { className: className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false", children: [_jsx("path", { d: "M12 5v14" }), _jsx("path", { d: "m19 12-7 7-7-7" })] }));
}
function SendHorizontalIcon({ className }) {
    return (_jsxs("svg", { className: className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false", children: [_jsx("path", { d: "M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z" }), _jsx("path", { d: "M6 12h16" })] }));
}
function PencilIcon({ className }) {
    return (_jsxs("svg", { className: className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false", children: [_jsx("path", { d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" }), _jsx("path", { d: "m15 5 4 4" })] }));
}
function Trash2Icon({ className }) {
    return (_jsxs("svg", { className: className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false", children: [_jsx("path", { d: "M3 6h18" }), _jsx("path", { d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" }), _jsx("path", { d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" }), _jsx("line", { x1: "10", x2: "10", y1: "11", y2: "17" }), _jsx("line", { x1: "14", x2: "14", y1: "11", y2: "17" })] }));
}
function CirclePauseIcon({ className }) {
    return (_jsxs("svg", { className: className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false", children: [_jsx("circle", { cx: "12", cy: "12", r: "10" }), _jsx("line", { x1: "10", x2: "10", y1: "15", y2: "9" }), _jsx("line", { x1: "14", x2: "14", y1: "15", y2: "9" })] }));
}
function ClockIcon({ className }) {
    return (_jsxs("svg", { className: className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false", children: [_jsx("circle", { cx: "12", cy: "12", r: "10" }), _jsx("polyline", { points: "12 6 12 12 16 14" })] }));
}
//# sourceMappingURL=queue-dock.js.map