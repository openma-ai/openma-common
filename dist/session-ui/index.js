"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { GitForkIcon, BotIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, CopyIcon, EyeIcon, HandIcon, ShieldAlertIcon, ShieldCheckIcon, ZapIcon, } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { OPENMA_MARK_CIRCLE, OPENMA_MARK_PATHS, OPENMA_MARK_VIEW_BOX, } from "../brand/index.js";
export function OpenMAMark({ className = "" }) {
    return (_jsxs("svg", { className: className, "data-openma-mark": "true", viewBox: OPENMA_MARK_VIEW_BOX, fill: "currentColor", "aria-hidden": "true", children: [OPENMA_MARK_PATHS.map((path) => _jsx("path", { d: path }, path)), _jsx("circle", { ...OPENMA_MARK_CIRCLE })] }));
}
/** Shared Backchat session switcher. Hosts own placement; common owns the
 * accessible menu behavior and visual vocabulary so it never falls back to a
 * platform-native select. */
export function SessionHistoryMenu({ activeSessionId, sessions, className = "", onSelectSession, }) {
    const menuRef = useRef(null);
    const activeSession = sessions.find(({ id }) => id === activeSessionId)
        ?? sessions[0];
    return (_jsxs("details", { className: `openma-session-history ${className}`.trim(), ref: menuRef, children: [_jsxs("summary", { className: "openma-session-history-trigger", "data-session-history-trigger": "true", "aria-label": "Chat history", title: activeSession?.title ?? "Chat history", children: [_jsx("span", { children: activeSession?.title ?? "New chat" }), _jsx(ChevronDownIcon, { size: 14, "aria-hidden": "true" })] }), _jsx("div", { className: "openma-session-menu openma-session-history-menu", role: "menu", "aria-label": "Chat history", children: sessions.map((session) => {
                    const active = session.id === activeSessionId;
                    return (_jsxs("button", { type: "button", role: "menuitemradio", "aria-checked": active, className: "openma-session-menu-item openma-session-history-item", onClick: () => {
                            onSelectSession(session.id);
                            menuRef.current?.removeAttribute("open");
                        }, children: [_jsx("span", { className: "openma-session-menu-item-copy", children: _jsx("strong", { children: session.title }) }), active ? _jsx(CheckIcon, { size: 14, "aria-hidden": "true" }) : null] }, session.id));
                }) })] }));
}
const HARNESS_ICON_PATHS = {
    "claude-acp": ["M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"],
    "codex-acp": ["M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z"],
    gemini: ["M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z"],
    opencode: ["M16 6H8v12h8V6zm4 16H4V2h16v20z"],
    kimi: [
        "M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z",
        "M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z",
    ],
};
export function HarnessIcon({ harnessId, label = harnessId, className = "", size = 14, }) {
    const paths = HARNESS_ICON_PATHS[harnessId];
    if (!paths)
        return _jsx(BotIcon, { className: className, size: size, "aria-label": label });
    return (_jsx("svg", { className: className, "data-harness-icon": harnessId, role: "img", "aria-label": label, width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", children: paths.map((path) => _jsx("path", { d: path }, path)) }));
}
export function SessionRunControls({ activeHarnessId, harnesses, configOptions, disabled = false, className = "", onSelectHarness, onSetConfigOption, }) {
    const activeHarness = harnesses.find(({ id }) => id === activeHarnessId);
    const modeOption = configOptions.find((option) => option.type === "select"
        && (option.category === "mode" || option.id === "mode"));
    const modelOption = configOptions.find((option) => option.category === "model");
    const runLabel = modelOption
        ? selectedSessionConfigOptionLabel(modelOption)
        : activeHarness?.label ?? activeHarnessId;
    return (_jsxs("div", { className: `openma-session-run-controls ${className}`.trim(), "data-session-run-controls": "true", "aria-label": "Run configuration", children: [modeOption ? (_jsx(SessionModeMenu, { harnessId: activeHarnessId, option: modeOption, disabled: disabled, onSetConfigOption: onSetConfigOption })) : _jsx("span", {}), _jsx(SessionRunMenu, { activeHarnessId: activeHarnessId, activeHarnessLabel: activeHarness?.label ?? activeHarnessId, harnesses: harnesses, configOptions: configOptions.filter((option) => option !== modeOption), summary: runLabel, disabled: disabled, onSelectHarness: onSelectHarness, onSetConfigOption: onSetConfigOption })] }));
}
function SessionModeMenu({ harnessId, option, disabled, onSetConfigOption, }) {
    const menuRef = useRef(null);
    const options = flattenSessionConfigSelectOptions(option.options);
    const selected = options.find(({ value }) => value === option.currentValue) ?? options[0];
    if (!selected)
        return null;
    const presentation = sessionModePresentation(harnessId, selected);
    const ModeIcon = sessionModeIcon(selected.value);
    return (_jsxs("details", { className: "openma-session-chip-menu", ref: menuRef, children: [_jsxs("summary", { className: `openma-session-toolbar-chip${presentation.warning ? " is-warning" : ""}`, "data-session-mode-trigger": "true", "aria-label": presentation.label, title: presentation.hint, "aria-disabled": disabled, onClick: (event) => {
                    if (disabled)
                        event.preventDefault();
                }, children: [_jsx(ModeIcon, { size: 14, "aria-hidden": "true" }), _jsx("span", { className: "openma-session-chip-label", children: presentation.label }), _jsx(ChevronDownIcon, { size: 14, "aria-hidden": "true" })] }), _jsx("div", { className: "openma-session-menu openma-session-menu-align-start", role: "menu", children: options.map((item) => {
                    const itemPresentation = sessionModePresentation(harnessId, item);
                    const ItemIcon = sessionModeIcon(item.value);
                    const active = item.value === option.currentValue;
                    return (_jsxs("button", { type: "button", role: "menuitemradio", "aria-checked": active, className: `openma-session-menu-item${itemPresentation.warning ? " is-warning" : ""}`, onClick: () => {
                            onSetConfigOption(option.id, item.value);
                            menuRef.current?.removeAttribute("open");
                        }, children: [_jsx(ItemIcon, { size: 15, "aria-hidden": "true" }), _jsxs("span", { className: "openma-session-menu-item-copy", children: [_jsx("strong", { children: itemPresentation.label }), itemPresentation.hint ? _jsx("small", { children: itemPresentation.hint }) : null] }), active ? _jsx(CheckIcon, { size: 14, "aria-hidden": "true" }) : null] }, item.value));
                }) })] }));
}
function SessionRunMenu({ activeHarnessId, activeHarnessLabel, harnesses, configOptions, summary, disabled, onSelectHarness, onSetConfigOption, }) {
    const menuRef = useRef(null);
    const [submenu, setSubmenu] = useState(null);
    useEffect(() => {
        const dismiss = (event) => {
            const details = menuRef.current;
            if (!details || details.contains(event.target))
                return;
            details.removeAttribute("open");
            setSubmenu(null);
        };
        const onKeyDown = (event) => {
            if (event.key !== "Escape")
                return;
            if (submenu !== null) {
                setSubmenu(null);
                event.stopPropagation();
                return;
            }
            menuRef.current?.removeAttribute("open");
        };
        document.addEventListener("pointerdown", dismiss);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", dismiss);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [submenu]);
    const closeMenu = () => {
        setSubmenu(null);
        menuRef.current?.removeAttribute("open");
    };
    const openRootSubmenu = (id) => setSubmenu((current) => current === id ? null : id);
    const activeOption = configOptions.find((option) => option.id === submenu);
    return (_jsxs("details", { className: "openma-session-chip-menu openma-session-run-menu", ref: menuRef, children: [_jsxs("summary", { className: "openma-session-toolbar-chip openma-session-run-trigger", "data-session-run-trigger": "true", "aria-label": `Run with ${activeHarnessLabel} using ${summary}`, "aria-disabled": disabled, onClick: (event) => {
                    if (disabled)
                        event.preventDefault();
                    setSubmenu(null);
                }, children: [_jsx(HarnessIcon, { harnessId: activeHarnessId, label: activeHarnessLabel, size: 15 }), _jsx("span", { className: "openma-session-chip-label", children: summary }), _jsx(ChevronDownIcon, { size: 14, "aria-hidden": "true" })] }), _jsxs("div", { className: "openma-session-menu openma-session-menu-align-end openma-session-run-root-menu", role: "menu", "data-session-run-root-menu": "true", children: [_jsx(SessionSubmenuTrigger, { submenuId: "harness", icon: _jsx(HarnessIcon, { harnessId: activeHarnessId, label: activeHarnessLabel, size: 15 }), label: "Harness", value: activeHarnessLabel, open: submenu === "harness", onClick: () => openRootSubmenu("harness") }), configOptions.map((option) => (_jsx(SessionSubmenuTrigger, { submenuId: option.id, icon: sessionConfigOptionIcon(option), label: option.name, value: selectedSessionConfigOptionLabel(option), open: submenu === option.id, onClick: () => openRootSubmenu(option.id) }, option.id)))] }), submenu === "harness" ? (_jsx("div", { className: "openma-session-submenu", role: "menu", "data-session-submenu": "harness", children: harnesses.map((harness) => {
                    const active = harness.id === activeHarnessId;
                    return (_jsx(SessionSubmenuChoice, { icon: _jsx(HarnessIcon, { harnessId: harness.id, label: harness.label, size: 15 }), label: harness.label, active: active, onClick: () => {
                            onSelectHarness(harness.id);
                            closeMenu();
                        } }, harness.id));
                }) })) : activeOption ? (_jsx("div", { className: "openma-session-submenu", role: "menu", "data-session-submenu": activeOption.id, children: activeOption.type === "boolean" ? (_jsx(SessionSubmenuChoice, { icon: _jsx(ZapIcon, { size: 15, "aria-hidden": "true" }), label: activeOption.currentValue ? "On" : "Off", active: activeOption.currentValue, role: "menuitemcheckbox", onClick: () => {
                        onSetConfigOption(activeOption.id, !activeOption.currentValue);
                        closeMenu();
                    } })) : (flattenSessionConfigSelectOptions(activeOption.options).map((item) => (_jsx(SessionSubmenuChoice, { label: item.name, hint: item.group, active: item.value === activeOption.currentValue, onClick: () => {
                        onSetConfigOption(activeOption.id, item.value);
                        closeMenu();
                    } }, `${activeOption.id}:${item.group ?? ""}:${item.value}`)))) })) : null] }));
}
function SessionSubmenuTrigger({ submenuId, icon, label, value, open, onClick, }) {
    return (_jsxs("button", { type: "button", role: "menuitem", "aria-haspopup": "menu", "aria-expanded": open, "aria-label": label, "data-session-submenu-trigger": submenuId, className: "openma-session-menu-item openma-session-submenu-trigger", onClick: onClick, children: [icon, _jsx("span", { className: "openma-session-menu-item-copy", children: _jsx("strong", { children: label }) }), _jsx("span", { className: "openma-session-submenu-value", children: value }), _jsx(ChevronRightIcon, { size: 14, "aria-hidden": "true" })] }));
}
function SessionSubmenuChoice({ icon, label, hint, active, role = "menuitemradio", onClick, }) {
    return (_jsxs("button", { type: "button", role: role, "aria-checked": active, className: "openma-session-menu-item openma-session-submenu-choice", onClick: onClick, children: [icon ?? _jsx("span", { className: "openma-session-submenu-placeholder", "aria-hidden": "true" }), _jsxs("span", { className: "openma-session-menu-item-copy", children: [_jsx("strong", { children: label }), hint ? _jsx("small", { children: hint }) : null] }), active ? _jsx(CheckIcon, { size: 14, "aria-hidden": "true" }) : null] }));
}
function sessionConfigOptionIcon(option) {
    if (option.type === "boolean")
        return _jsx(ZapIcon, { size: 15, "aria-hidden": "true" });
    if (option.category === "model")
        return _jsx(BotIcon, { size: 15, "aria-hidden": "true" });
    if (option.category === "thought_level")
        return _jsx(EyeIcon, { size: 15, "aria-hidden": "true" });
    return _jsx(ZapIcon, { size: 15, "aria-hidden": "true" });
}
function selectedSessionConfigOptionLabel(option) {
    if (option.type === "boolean")
        return option.currentValue ? "On" : "Off";
    return flattenSessionConfigSelectOptions(option.options)
        .find(({ value }) => value === option.currentValue)?.name
        ?? option.currentValue;
}
function sessionModePresentation(harnessId, option) {
    if (harnessId === "codex-acp") {
        if (option.value === "read-only") {
            return {
                label: "Ask for approval",
                hint: "Always ask before editing external files or using the internet",
            };
        }
        if (option.value === "agent") {
            return {
                label: "Approve for me",
                hint: "Only ask for actions detected as potentially unsafe",
            };
        }
        if (option.value === "agent-full-access") {
            return {
                label: "Full access",
                hint: "Allow unrestricted internet and filesystem access",
                warning: true,
            };
        }
    }
    return {
        label: option.name,
        ...(option.description ? { hint: option.description } : {}),
    };
}
function sessionModeIcon(value) {
    if (value === "read-only")
        return HandIcon;
    if (value === "agent-full-access")
        return ShieldAlertIcon;
    return ShieldCheckIcon;
}
export function flattenSessionConfigSelectOptions(options) {
    return options.flatMap((entry) => "options" in entry
        ? entry.options.map((option) => ({
            value: option.value,
            name: option.name,
            group: entry.name,
        }))
        : [{ value: entry.value, name: entry.name }]);
}
/**
 * Shared DOM shell for a Backchat/OpenManaged session turn.
 *
 * Product adapters keep ownership of Markdown, tools, plans, subagents, and
 * stores; this component owns the stable prompt/response hierarchy and status
 * semantics so both products can evolve those slots without forking the
 * session-level GUI structure again.
 */
export function SessionTurnFrame({ turnId, sessionId, promptText, promptNode, status, errorMessage, errorNotice, labels, hideStatusMessage = false, children, className = "", }) {
    const isStreaming = status === "running";
    const statusNode = hideStatusMessage
        ? null
        : (status === "error" || status === "errored") && errorNotice !== undefined
            ? errorNotice
            : renderStatus(status, errorMessage, labels);
    return (_jsxs("article", { className: `group/turn reveal-in mb-6 space-y-2 ${className}`.trim(), "data-turn-id": turnId, "data-session-turn-status": status, children: [promptNode ??
                (promptText ? (_jsx("div", { className: "group is-user ml-auto flex w-full max-w-[95%] flex-col items-end gap-2", "data-session-turn-prompt": "true", children: _jsx("div", { className: "is-user:dark ml-auto flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden rounded-lg bg-secondary px-4 py-3 text-sm text-foreground", children: _jsx("p", { className: "whitespace-pre-wrap", children: promptText }) }) })) : null), _jsx("div", { className: "min-w-0", "data-annotatable-response": true, "data-annotation-ready": !isStreaming, "data-source-session-id": sessionId, "data-source-turn-id": turnId, children: _jsxs("div", { className: "min-w-0 space-y-2", "data-session-turn-response": "true", children: [children, statusNode] }) })] }));
}
/** Backchat-compatible metadata and actions for the end of a session turn. */
export function SessionTurnFooter({ status, timestamp, copyText, labels, onFork, writeClipboard, formatTimestamp = defaultTurnTimestamp, }) {
    const [copied, setCopied] = useState(false);
    const resetTimerRef = useRef(undefined);
    const isStreaming = status === "running";
    const answer = copyText.trim();
    const endedAt = isStreaming ? undefined : timestamp;
    const canFork = Boolean(onFork) &&
        (status === "complete" || status === "completed") &&
        answer.length > 0;
    const timestampLabel = endedAt === undefined ? null : formatTimestamp(endedAt);
    const layer = "col-start-1 row-start-1 flex min-w-0 items-center transition-opacity duration-200 ease-out";
    useEffect(() => () => {
        if (resetTimerRef.current !== undefined) {
            clearTimeout(resetTimerRef.current);
        }
    }, []);
    const copyAnswer = async () => {
        if (!answer)
            return;
        try {
            if (writeClipboard) {
                await writeClipboard(answer);
            }
            else if (typeof navigator !== "undefined" &&
                typeof navigator.clipboard?.writeText === "function") {
                await navigator.clipboard.writeText(answer);
            }
            else {
                return;
            }
            setCopied(true);
            if (resetTimerRef.current !== undefined) {
                clearTimeout(resetTimerRef.current);
            }
            resetTimerRef.current = setTimeout(() => setCopied(false), 1_200);
        }
        catch {
            // Clipboard denial leaves the action unchanged; the host may surface a
            // product-specific error through its injected writer.
        }
    };
    return (_jsxs("div", { "data-turn-footer": "true", className: "grid h-7 grid-cols-1 grid-rows-1", children: [_jsx("div", { className: `${layer} ${isStreaming ? "opacity-100" : "pointer-events-none opacity-0"}`, "aria-hidden": isStreaming ? undefined : true }), _jsxs("div", { className: `${layer} justify-start gap-1 ${isStreaming ? "pointer-events-none opacity-0" : "opacity-100"}`, "aria-hidden": isStreaming ? true : undefined, children: [endedAt !== undefined && timestampLabel !== null ? (_jsx("time", { "data-turn-timestamp": String(endedAt), className: "mr-1 text-xs leading-5 text-fg-subtle", children: timestampLabel })) : null, answer ? (_jsx("button", { type: "button", "data-turn-copy-action": "true", "aria-label": copied ? labels.answerCopied : labels.copyAnswer, title: copied ? labels.answerCopied : labels.copyAnswer, onClick: () => void copyAnswer(), className: "inline-flex size-7 items-center justify-center rounded-full text-fg-subtle transition-colors hover:bg-bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", children: copied ? (_jsx(CheckIcon, { className: "size-4", "aria-hidden": "true" })) : (_jsx(CopyIcon, { className: "size-4", "aria-hidden": "true" })) })) : null, canFork ? (_jsx("button", { type: "button", "data-turn-fork-action": "true", "aria-label": labels.continueInNewChat, title: labels.continueInNewChat, onClick: onFork, className: "inline-flex size-7 items-center justify-center rounded-full text-fg-subtle transition-colors hover:bg-bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", children: _jsx(GitForkIcon, { className: "size-4", "aria-hidden": "true" }) })) : null] })] }));
}
function defaultTurnTimestamp(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime()))
        return null;
    return date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
    });
}
function renderStatus(status, errorMessage, labels) {
    if (status === "error" || status === "errored") {
        return (_jsx("p", { className: "rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger", "data-session-turn-status-message": "error", role: "alert", children: errorMessage ?? labels?.failed ?? "Turn failed." }));
    }
    if (status === "queued") {
        return (_jsx("p", { className: "text-xs italic text-fg-subtle", "data-session-turn-status-message": "queued", children: labels?.queued ?? "queued" }));
    }
    if (status === "cancelled") {
        return (_jsx("p", { className: "text-xs italic text-fg-subtle", "data-session-turn-status-message": "cancelled", children: labels?.cancelled ?? "cancelled" }));
    }
    if (status === "unknown") {
        return (_jsx("p", { className: "text-xs italic text-fg-subtle", "data-session-turn-status-message": "unknown", children: labels?.unknown ?? "terminal status unavailable" }));
    }
    if (status === "terminated") {
        return (_jsx("p", { className: "text-xs italic text-fg-subtle", "data-session-turn-status-message": "terminated", children: labels?.terminated ?? "terminated" }));
    }
    return null;
}
//# sourceMappingURL=index.js.map