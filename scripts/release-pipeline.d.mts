export function releaseIdentity(tag: string, version: string): {version: string; channel: string; branch: string};
export function validatePublishedIntegrity(expected: string, actual: string | undefined): void;
