export declare const ACP_AUTH_REQUIRED_CODE = -32000;
export declare function isAuthRequired(error: unknown): boolean;
/** Auth-required JSON-RPC error whose message is the ACP authentication
 * failure, not every -32000. Session setup retries and auth probes use this
 * narrower check; `isAuthRequired` stays code-only for existing callers. */
export declare function isAuthenticationRequiredError(error: unknown): boolean;
//# sourceMappingURL=errors.d.ts.map