/** Backchat's tool projection: one latest completed row per semantic target,
 * plus the latest live tool while a turn is streaming. */
export function projectAgentUIActivityTools(turn, isStreaming) {
    const tools = turn.items.filter((item) => item.kind === "tool");
    const activeTools = isStreaming
        ? tools.filter((tool) => isAgentUIToolRunning(tool.status))
        : [];
    const activeTool = activeTools.at(-1);
    const latestCompletedBySignature = new Map();
    for (const tool of tools) {
        if (isStreaming && isAgentUIToolRunning(tool.status))
            continue;
        latestCompletedBySignature.set(agentUIActivityToolSignature(tool), tool.id);
    }
    if (activeTool) {
        latestCompletedBySignature.delete(agentUIActivityToolSignature(activeTool));
    }
    return {
        activeTool,
        visibleToolIds: new Set(latestCompletedBySignature.values()),
    };
}
/** Backchat's uninterrupted activity grouping. Assistant text is the only
 * boundary; thoughts and tools remain one chronological disclosure. */
export function groupAgentUIActivityEvents(items, { toolsById }) {
    const groups = new Map();
    let start;
    let children = [];
    const flush = () => {
        if (start !== undefined && children.length > 0)
            groups.set(start, children);
        start = undefined;
        children = [];
    };
    items.forEach((item, index) => {
        if (item.kind === "message") {
            flush();
            return;
        }
        if (item.kind === "thinking") {
            if (start === undefined)
                start = index;
            children.push({ item, index });
            return;
        }
        if (item.kind !== "tool")
            return;
        const tool = toolsById.get(item.id);
        if (!tool)
            return;
        if (start === undefined)
            start = index;
        children.push({ item, index, tool });
    });
    flush();
    return groups;
}
export function isAgentUIToolRunning(status) {
    return (status === undefined || status === "pending" || status === "in_progress");
}
export function settleInterruptedAgentUIToolStatus(status) {
    if (isAgentUIToolRunning(status))
        return "cancelled";
    return status ?? "cancelled";
}
export function pickAgentUIToolTarget(tool) {
    if (tool.toolKind === "execute" ||
        tool.toolKind === "terminal") {
        const command = executedCommand(tool.rawInput);
        if (command)
            return command;
    }
    if (tool.title)
        return tool.title;
    const location = tool.locations?.find((entry) => entry.path)?.path;
    if (location)
        return shortAgentUIToolPath(location);
    for (const block of tool.content ?? []) {
        if (!block || typeof block !== "object")
            continue;
        const value = block;
        if (value.type === "diff" && typeof value.path === "string") {
            return shortAgentUIToolPath(value.path);
        }
        const content = record(value.content);
        if (value.type === "content" &&
            content?.type === "text" &&
            typeof content.text === "string") {
            return content.text.split(/\r?\n/, 1)[0]?.trim() ?? "";
        }
    }
    return "";
}
export function pickAgentUIToolActivityTarget(tool, translateSkill) {
    const skillName = detectAgentUISkillName(tool);
    if (!skillName)
        return pickAgentUIToolTarget(tool);
    const label = capitalizeAgentUIToolLabel(skillName);
    return translateSkill ? translateSkill(label) : label;
}
export function detectAgentUISkillName(tool) {
    const skillPattern = /\/skills\/(?:\.system\/)?([^/]+)\/SKILL\.md(?:$|[?#])/i;
    for (const location of tool.locations ?? []) {
        const match = location.path?.match(skillPattern);
        if (match?.[1])
            return match[1];
    }
    const rawInput = record(tool.rawInput);
    if (rawInput && Array.isArray(rawInput.command)) {
        for (const argument of rawInput.command) {
            if (typeof argument !== "string")
                continue;
            const match = argument.match(skillPattern);
            if (match?.[1])
                return match[1];
        }
    }
    return null;
}
export function agentUIToolRunSummaryKinds(tools) {
    const counts = new Map();
    for (const tool of tools) {
        const kind = agentUIToolSummaryKind(tool.toolKind);
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    return [...counts].map(([kind, count]) => ({ kind, count }));
}
export function capitalizeAgentUIToolLabel(value) {
    if (!value)
        return value;
    return value.charAt(0).toUpperCase() + value.slice(1);
}
export function shortAgentUIToolPath(path) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length <= 2)
        return path;
    return `…/${parts.slice(-2).join("/")}`;
}
function agentUIActivityToolSignature(tool) {
    const skill = detectAgentUISkillName(tool);
    return [
        tool.toolKind ?? "",
        skill
            ? `skill:${skill.toLowerCase()}`
            : pickAgentUIToolTarget(tool),
    ].join(":");
}
function agentUIToolSummaryKind(kind) {
    switch (kind) {
        case "read":
        case "edit":
        case "delete":
        case "move":
        case "execute":
        case "fetch":
        case "think":
        case "list":
            return kind;
        case "search":
        case "grep":
            return "search";
        case "terminal":
            return "execute";
        case "web":
            return "fetch";
        case "tree":
            return "list";
        case "switch_mode":
            return "switchMode";
        default:
            return "other";
    }
}
function executedCommand(rawInput) {
    const raw = record(rawInput);
    const command = raw?.command;
    if (typeof command === "string")
        return command.trim();
    if (!Array.isArray(command))
        return "";
    const argv = command.filter((part) => typeof part === "string");
    const shellIndex = argv.findIndex((part) => part === "-lc" || part === "-c");
    const script = shellIndex >= 0 ? argv[shellIndex + 1] : undefined;
    return (script ?? argv.join(" ")).trim();
}
function record(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
}
//# sourceMappingURL=presentation.js.map