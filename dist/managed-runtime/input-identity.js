/** Scoped event identity used for retry-safe Session input and history reconciliation. */
export async function sessionInputIdentityPrefix(workspaceId, sessionId, key) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([workspaceId, sessionId, key])));
    return `sevt_req_${Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("")}_`;
}
//# sourceMappingURL=input-identity.js.map