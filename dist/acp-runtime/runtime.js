import { AcpSessionImpl } from "./session.js";
let nextId = 1;
const DEFAULT_INIT_TIMEOUT_MS = 120_000;
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
        const initTimeoutMs = options.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;
        const init = session.init();
        void init.catch(() => undefined);
        let timer;
        try {
            if (initTimeoutMs > 0) {
                await Promise.race([
                    init,
                    new Promise((_, reject) => {
                        timer = setTimeout(() => reject(new Error(`ACP session init timed out after ${initTimeoutMs}ms`)), initTimeoutMs);
                        timer.unref?.();
                    }),
                ]);
            }
            else {
                await init;
            }
            if (process.env.NODE_ENV !== "test") {
                process.stderr.write(`[acp-runtime] id=${id} command=${options.agent.command} total_ms=${Date.now() - startedAt}\n`);
            }
        }
        catch (error) {
            await session.dispose();
            throw error;
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
        return session;
    }
}
//# sourceMappingURL=runtime.js.map