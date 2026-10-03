/**
 * Projects host boundary.
 *
 * `@openma/common/project-ui` renders against this interface and nothing else.
 * Backchat implements it on top of its desktop bridge. The OMA console
 * implements it over HTTP. Neither implementation is imported here: there is
 * no Node, Electron, or network code in this entry.
 */
export function emptyProjectFacts() {
    return {
        sessions: [],
        turns: [],
        events: [],
        agentEvents: [],
        contexts: [],
        goals: [],
        reactions: [],
    };
}
/** Puts the primary folder first and drops blanks and duplicates. */
export function normalizeProjectFolders(input) {
    const folders = [];
    const seen = new Set();
    for (const raw of input.source_folders) {
        const folder = raw.trim();
        if (!folder || seen.has(folder))
            continue;
        seen.add(folder);
        folders.push(folder);
    }
    const requestedPrimary = input.primary_folder?.trim() ?? "";
    const primary = requestedPrimary && seen.has(requestedPrimary)
        ? requestedPrimary
        : folders[0] ?? "";
    return {
        primary_folder: primary,
        source_folders: primary
            ? [primary, ...folders.filter((folder) => folder !== primary)]
            : folders,
    };
}
//# sourceMappingURL=client.js.map