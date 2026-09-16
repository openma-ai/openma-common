import { describe, expect, it } from "vitest";
import * as chatUI from "../src/chat-ui/index.js";

interface TestStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function memoryStorage(): TestStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

type ComposerDraftStoreFactory = (options: {
  namespace: string;
  storage?: TestStorage;
}) => {
  read(scope: string): string;
  write(scope: string, value: string): void;
  clear(scope: string): void;
};

function draftStoreFactory(): ComposerDraftStoreFactory | undefined {
  return (
    chatUI as typeof chatUI & {
      createComposerDraftStore?: ComposerDraftStoreFactory;
    }
  ).createComposerDraftStore;
}

describe("composer draft storage", () => {
  it("restores a different draft for each session after recreating the store", () => {
    const createStore = draftStoreFactory();
    expect(createStore).toBeTypeOf("function");
    if (!createStore) return;
    const storage = memoryStorage();

    const openComposer = createStore({ namespace: "backchat", storage });
    openComposer.write("session-a", "finish the storyboard");
    openComposer.write("session-b", "compare both cuts");

    const reopenedComposer = createStore({ namespace: "backchat", storage });
    expect(reopenedComposer.read("session-a")).toBe("finish the storyboard");
    expect(reopenedComposer.read("session-b")).toBe("compare both cuts");
  });

  it("clears only the submitted session draft", () => {
    const createStore = draftStoreFactory();
    expect(createStore).toBeTypeOf("function");
    if (!createStore) return;
    const storage = memoryStorage();
    const drafts = createStore({ namespace: "clash", storage });
    drafts.write("session-a", "send this");
    drafts.write("session-b", "keep this");

    drafts.clear("session-a");

    expect(drafts.read("session-a")).toBe("");
    expect(drafts.read("session-b")).toBe("keep this");
  });

  it("does not overwrite another mounted composer's session draft", () => {
    const createStore = draftStoreFactory();
    expect(createStore).toBeTypeOf("function");
    if (!createStore) return;
    const storage = memoryStorage();
    const mainComposer = createStore({ namespace: "backchat", storage });
    const sideComposer = createStore({ namespace: "backchat", storage });

    mainComposer.write("main-session", "main draft");
    sideComposer.write("side-session", "side draft");

    const reopenedComposer = createStore({ namespace: "backchat", storage });
    expect(reopenedComposer.read("main-session")).toBe("main draft");
    expect(reopenedComposer.read("side-session")).toBe("side draft");
  });

  it("keeps working in memory when persistent storage throws", () => {
    const createStore = draftStoreFactory();
    expect(createStore).toBeTypeOf("function");
    if (!createStore) return;
    const unavailableStorage: TestStorage = {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
      removeItem: () => {
        throw new Error("storage unavailable");
      },
    };
    const drafts = createStore({
      namespace: "private-window",
      storage: unavailableStorage,
    });

    drafts.write("session-a", "still switchable");

    expect(drafts.read("session-a")).toBe("still switchable");
  });

  it("keeps the latest in-memory draft when storage is readable but full", () => {
    const createStore = draftStoreFactory();
    expect(createStore).toBeTypeOf("function");
    if (!createStore) return;
    const fullStorage: TestStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
      removeItem: () => undefined,
    };
    const drafts = createStore({
      namespace: "full-storage",
      storage: fullStorage,
    });

    drafts.write("session-a", "do not discard this");

    expect(drafts.read("session-a")).toBe("do not discard this");
  });
});
