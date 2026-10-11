/**
 * Builds the launch of an ACP harness for one unattended run from the
 * harness's own recipe (`KnownAgentEntry.headless`). Hosts pass generic
 * options; every flag and variable name comes from the registry entry.
 *
 * Browser-safe (no node deps).
 */
function definedEnv(env) {
    return Object.fromEntries(Object.entries(env ?? {}).filter((entry) => typeof entry[1] === "string"));
}
export function buildAcpHeadlessLaunch(entry, options = {}) {
    const recipe = entry.headless;
    if (!recipe) {
        throw new Error(`${entry.label} (${entry.id}) has no headless launch recipe`);
    }
    const args = [...(entry.spec.args ?? []), ...(recipe.args ?? [])];
    const env = definedEnv(entry.spec.env);
    const unsupported = [];
    if (options.sessionDir !== undefined) {
        if (recipe.sessionDir)
            args.push(recipe.sessionDir.flag, options.sessionDir);
        else
            unsupported.push("sessionDir");
    }
    if (options.agentDir !== undefined) {
        const { flag, env: variable } = recipe.agentDir ?? {};
        if (flag)
            args.push(flag, options.agentDir);
        if (variable)
            env[variable] = options.agentDir;
        if (!flag && !variable)
            unsupported.push("agentDir");
    }
    if (options.trustProject) {
        if (recipe.trustProject)
            args.push(recipe.trustProject.flag);
        else
            unsupported.push("trustProject");
    }
    const { model, provider, thinkingLevel } = options;
    if (model !== undefined) {
        if (recipe.model) {
            const { flag, providerSeparator, thinkingSeparator } = recipe.model;
            const prefix = provider !== undefined && providerSeparator !== undefined
                ? `${provider}${providerSeparator}`
                : "";
            const suffix = thinkingLevel !== undefined && thinkingSeparator !== undefined
                ? `${thinkingSeparator}${thinkingLevel}`
                : "";
            // A model id that already names its provider is not prefixed twice.
            args.push(flag, `${prefix && !model.startsWith(prefix) ? prefix : ""}${model}${suffix}`);
        }
        else {
            unsupported.push("model");
        }
    }
    if (provider !== undefined && recipe.model?.providerSeparator === undefined) {
        unsupported.push("provider");
    }
    if (thinkingLevel !== undefined &&
        recipe.model?.thinkingSeparator === undefined) {
        unsupported.push("thinkingLevel");
    }
    return { args, env, unsupported };
}
//# sourceMappingURL=headless-launch.js.map