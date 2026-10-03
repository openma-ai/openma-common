export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

export type Bump = "major" | "minor" | "patch" | "downgrade" | "same";

export interface ReleaseCommit {
  sha: string;
  subject: string;
}

export function parseVersion(version: string): SemVer;
export function classifyBump(previous: SemVer, next: SemVer): Bump;
export function extractPrNumbers(message: string): number[];
export function mentionsPr(notes: string, number: number): boolean;
export function missingPrNumbers(notes: string, numbers: readonly number[]): number[];
export function readmePinErrors(readme: string, version: string): string[];
export function unreleasedNoteNames(names: readonly string[]): string[];
export function bumpLabelErrors(bump: Bump, labels: readonly string[], previous: string, next: string): string[];
export function uniquePrNumbers(commits: readonly ReleaseCommit[]): number[];
export function unreleasedNotices(input: {
  previousTag: string | null;
  baseRevision: string;
  commits: readonly ReleaseCommit[];
}): string[];
export function evaluateVersionBump(input: {
  previousVersion: string;
  nextVersion: string;
  labels: readonly string[];
  notes: string | null;
  notesPath: string;
  readme: string;
  unreleasedNames: readonly string[];
  mergedPrNumbers: readonly number[];
  previousTag: string | null;
  baseRevision: string;
}): string[];
