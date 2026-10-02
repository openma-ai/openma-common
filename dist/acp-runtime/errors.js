export const ACP_AUTH_REQUIRED_CODE = -32000;
const AUTHENTICATION_REQUIRED_MESSAGE = /^Authentication required\b/i;
export function isAuthRequired(error) {
    return Boolean(error &&
        typeof error === "object" &&
        error.code === ACP_AUTH_REQUIRED_CODE);
}
/** Auth-required JSON-RPC error whose message is the ACP authentication
 * failure, not every -32000. Session setup retries and auth probes use this
 * narrower check; `isAuthRequired` stays code-only for existing callers. */
export function isAuthenticationRequiredError(error) {
    if (!isAuthRequired(error))
        return false;
    const message = error.message;
    return typeof message === "string" && AUTHENTICATION_REQUIRED_MESSAGE.test(message);
}
//# sourceMappingURL=errors.js.map