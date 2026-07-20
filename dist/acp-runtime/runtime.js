import { AcpSessionImpl } from "./session.js";
let nextId = 1;
export class AcpRuntimeImpl {
    #spawner;
    constructor(spawner) {
        this.#spawner = spawner;
    }
    async start(options) {
        const startedAt = Date.now();
        const id = `acp-${startedAt}-${nextId++}`;
        const child = await this.#spawner.spawn(options.agent);
        const session = new AcpSessionImpl({ child, options, id });
        try {
            await session.init();
            if (process.env.NODE_ENV !== "test") {
                process.stderr.write(`[acp-runtime] id=${id} command=${options.agent.command} total_ms=${Date.now() - startedAt}\n`);
            }
        }
        catch (error) {
            await session.dispose();
            throw error;
        }
        return session;
    }
}
//# sourceMappingURL=runtime.js.map