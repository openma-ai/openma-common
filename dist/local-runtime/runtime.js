import { ManagedAgentsSessionHost, } from "./session-host.js";
class ManagedAgentsRuntimeLoop {
    #sessionPreparation;
    #sessionHost;
    #sink;
    constructor(dependencies) {
        this.#sessionPreparation = dependencies.sessionPreparation;
        this.#sessionHost = new ManagedAgentsSessionHost({
            runtime: dependencies.acpRuntime,
            emit: (event) => this.#sink?.publish(event),
            scheduler: dependencies.scheduler,
            cancelGraceMs: dependencies.cancelGraceMs,
            checkpointStore: dependencies.checkpointStore,
            hostInstanceId: dependencies.hostInstanceId,
        });
    }
    attach(sink) {
        this.#sink = sink;
        this.#sessionHost.announceAll();
    }
    async dispatch(command) {
        switch (command.type) {
            case "session.start": {
                if (this.#sessionHost.announce(command.sessionId))
                    return;
                let options;
                try {
                    options = await this.#sessionPreparation.prepare(command);
                }
                catch (error) {
                    this.#sink?.publish({
                        type: "session.error",
                        sessionId: command.sessionId,
                        message: error instanceof Error ? error.message : String(error),
                    });
                    return;
                }
                await this.#sessionHost.start({ sessionId: command.sessionId, options });
                return;
            }
            case "session.prompt":
                await this.#sessionHost.prompt({
                    sessionId: command.sessionId,
                    turnId: command.turnId,
                    text: command.text,
                });
                return;
            case "session.steer":
                await this.#sessionHost.steer({
                    sessionId: command.sessionId,
                    eventId: command.eventId,
                    text: command.text,
                });
                return;
            case "session.cancel":
                await this.#sessionHost.cancel(command.sessionId, command.turnId);
                return;
            case "session.dispose":
                await this.#sessionHost.dispose(command.sessionId);
                return;
        }
    }
    drain(options) {
        return this.#sessionHost.drain(options);
    }
    announceAll() {
        this.#sessionHost.announceAll();
    }
    hasSession(sessionId) {
        return this.#sessionHost.has(sessionId);
    }
    sessionCount() {
        return this.#sessionHost.sessionCount();
    }
    activeTurnCount() {
        return this.#sessionHost.activeTurnCount();
    }
}
export function createManagedAgentsRuntime(dependencies) {
    return new ManagedAgentsRuntimeLoop(dependencies);
}
//# sourceMappingURL=runtime.js.map