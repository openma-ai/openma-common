export interface ComposerDraftStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
export interface ComposerDraftStore {
    read(scope: string): string;
    write(scope: string, value: string): void;
    clear(scope: string): void;
}
export interface CreateComposerDraftStoreOptions {
    namespace: string;
    storage?: ComposerDraftStorage | null;
}
/**
 * Stores unsent composer text under an application namespace and a host-owned
 * scope such as a session id. Persistence is best effort: an unavailable or
 * full browser store falls back to the in-memory copy for this lifetime.
 */
export declare function createComposerDraftStore({ namespace, storage, }: CreateComposerDraftStoreOptions): ComposerDraftStore;
//# sourceMappingURL=composer-drafts.d.ts.map