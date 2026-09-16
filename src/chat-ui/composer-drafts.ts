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
export function createComposerDraftStore({
  namespace,
  storage,
}: CreateComposerDraftStoreOptions): ComposerDraftStore {
  const drafts = new Map<string, string>();
  const unpersistedScopes = new Set<string>();
  const storageKey = (scope: string) =>
    `openma.composer-drafts.${namespace}.v1.${encodeURIComponent(scope)}`;

  const clear = (scope: string) => {
    drafts.delete(scope);
    if (!storage) return;
    try {
      storage.removeItem(storageKey(scope));
      unpersistedScopes.delete(scope);
    } catch {
      unpersistedScopes.add(scope);
    }
  };

  return {
    read: (scope) => {
      if (!storage || unpersistedScopes.has(scope)) {
        return drafts.get(scope) ?? "";
      }
      try {
        const value = storage.getItem(storageKey(scope));
        if (value === null) drafts.delete(scope);
        else drafts.set(scope, value);
        return value ?? "";
      } catch {
        return drafts.get(scope) ?? "";
      }
    },
    write: (scope, value) => {
      if (value.length === 0) {
        clear(scope);
        return;
      }
      drafts.set(scope, value);
      if (!storage) return;
      try {
        storage.setItem(storageKey(scope), value);
        unpersistedScopes.delete(scope);
      } catch {
        unpersistedScopes.add(scope);
      }
    },
    clear,
  };
}
