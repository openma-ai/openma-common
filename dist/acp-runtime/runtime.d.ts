import type { AcpRuntime, AcpSession, SessionOptions, Spawner } from "./types.js";
export declare class AcpRuntimeImpl implements AcpRuntime {
    #private;
    constructor(spawner: Spawner);
    start(options: SessionOptions): Promise<AcpSession>;
}
//# sourceMappingURL=runtime.d.ts.map