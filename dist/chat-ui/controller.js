import { createAgentUIStore, } from "../agent-ui/index.js";
import { createOpenMAEvent, } from "../session-events/openma.js";
/** AI SDK-shaped, framework-neutral chat controller over OpenMA events.
 * It deliberately owns no history adapter or persistence surface. */
export function createAgentChatController({ id, transport, setup, createTurnId = defaultTurnId, now = () => new Date(), }) {
    const store = createAgentUIStore(id);
    const listeners = new Set();
    let status = "ready";
    let error;
    let activeAbort;
    let activeTurnId;
    const notify = () => {
        for (const listener of listeners)
            listener();
    };
    const setStatus = (next) => {
        if (status === next)
            return;
        status = next;
        notify();
    };
    const setError = (next) => {
        if (error === next)
            return;
        error = next;
        notify();
    };
    const consume = async (stream, abort) => {
        const reader = stream.getReader();
        try {
            while (true) {
                const next = await reader.read();
                if (next.done)
                    break;
                if (abort.signal.aborted)
                    break;
                store.dispatch(next.value);
            }
        }
        finally {
            reader.releaseLock();
        }
    };
    const run = async (trigger, prompt, options) => {
        if (activeAbort)
            throw new Error("A chat turn is already streaming.");
        const turnId = options.turnId ?? createTurnId();
        const abort = new AbortController();
        activeAbort = abort;
        activeTurnId = turnId;
        setError(undefined);
        if (trigger === "submit-message") {
            dispatchOptimisticPrompt(store, id, turnId, prompt, now());
        }
        setStatus("submitted");
        try {
            const stream = await transport.sendMessages({
                trigger,
                chatId: id,
                turnId,
                prompt,
                setup,
                abortSignal: abort.signal,
                ...(options.headers ? { headers: options.headers } : {}),
                ...(options.body ? { body: options.body } : {}),
                ...(options.metadata !== undefined
                    ? { metadata: options.metadata }
                    : {}),
            });
            if (!abort.signal.aborted)
                setStatus("streaming");
            await consume(stream, abort);
            if (!abort.signal.aborted)
                setStatus("ready");
        }
        catch (reason) {
            if (abort.signal.aborted) {
                setStatus("ready");
                return;
            }
            const nextError = reason instanceof Error ? reason : new Error(String(reason));
            setError(nextError);
            store.dispatch(createOpenMAEvent({
                event_id: `${turnId}:controller-error`,
                type: "session.error",
                session_id: id,
                turn_id: turnId,
                source: { kind: "openma" },
                occurred_at: now().toISOString(),
                data: { message: nextError.message },
            }));
            setStatus("error");
            throw nextError;
        }
        finally {
            if (activeAbort === abort)
                activeAbort = undefined;
            if (activeTurnId === turnId)
                activeTurnId = undefined;
        }
    };
    const controller = {
        id,
        store,
        get state() {
            return store.getState();
        },
        get status() {
            return status;
        },
        get error() {
            return error;
        },
        setup,
        sendMessage(prompt, options = {}) {
            return run("submit-message", prompt, options);
        },
        regenerate(prompt, options) {
            return run("regenerate-message", prompt, options);
        },
        async resumeStream(options = {}) {
            if (activeAbort)
                return false;
            const abort = new AbortController();
            activeAbort = abort;
            setError(undefined);
            try {
                const stream = await transport.reconnectToStream({
                    chatId: id,
                    setup,
                    abortSignal: abort.signal,
                    ...options,
                });
                if (!stream)
                    return false;
                setStatus("streaming");
                await consume(stream, abort);
                if (!abort.signal.aborted)
                    setStatus("ready");
                return true;
            }
            catch (reason) {
                if (abort.signal.aborted)
                    return false;
                const nextError = reason instanceof Error
                    ? reason
                    : new Error(String(reason));
                setError(nextError);
                setStatus("error");
                throw nextError;
            }
            finally {
                if (activeAbort === abort)
                    activeAbort = undefined;
            }
        },
        async stop() {
            const abort = activeAbort;
            activeAbort = undefined;
            abort?.abort();
            await transport.stop?.({ chatId: id, turnId: activeTurnId });
            activeTurnId = undefined;
            setStatus("ready");
        },
        clearError() {
            setError(undefined);
            if (status === "error")
                setStatus("ready");
        },
        subscribe(listener) {
            listeners.add(listener);
            const unsubscribeStore = store.subscribe(() => listener());
            return () => {
                listeners.delete(listener);
                unsubscribeStore();
            };
        },
    };
    return controller;
}
function dispatchOptimisticPrompt(store, sessionId, turnId, prompt, occurredAt) {
    const timestamp = occurredAt.toISOString();
    store.dispatch(createOpenMAEvent({
        event_id: `${turnId}:queued`,
        type: "turn.queued",
        session_id: sessionId,
        turn_id: turnId,
        source: { kind: "openma" },
        occurred_at: timestamp,
        data: {},
    }));
    store.dispatch(createOpenMAEvent({
        event_id: `${turnId}:prompt`,
        type: "user.message",
        session_id: sessionId,
        turn_id: turnId,
        source: { kind: "user" },
        occurred_at: timestamp,
        data: {
            message_id: `${turnId}:prompt`,
            text: prompt.text,
            ...(prompt.attachments ? { content: prompt.attachments } : {}),
        },
    }));
    store.dispatch(createOpenMAEvent({
        event_id: `${turnId}:running`,
        type: "session.running",
        session_id: sessionId,
        turn_id: turnId,
        source: { kind: "openma" },
        occurred_at: timestamp,
        data: {},
    }));
}
function defaultTurnId() {
    return `turn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
//# sourceMappingURL=controller.js.map