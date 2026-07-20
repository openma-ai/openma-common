export const ACP_AUTH_REQUIRED_CODE = -32000;
export function isAuthRequired(error) {
    return Boolean(error &&
        typeof error === "object" &&
        error.code === ACP_AUTH_REQUIRED_CODE);
}
//# sourceMappingURL=errors.js.map