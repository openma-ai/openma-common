import { describe, expect, it } from "vitest";
import {
  bumpLabelErrors,
  classifyBump,
  evaluateVersionBump,
  extractPrNumbers,
  mentionsPr,
  missingPrNumbers,
  parseVersion,
  readmePinErrors,
  uniquePrNumbers,
  unreleasedNoteNames,
  unreleasedNotices,
} from "../scripts/release-check.mjs";

const readme = (version: string) => `{"@openma/common": "github:openma-ai/openma-common#v${version}"}`;

describe("release check", () => {
  it("parses x.y.z and rejects anything else", () => {
    expect(parseVersion("0.7.2")).toEqual({ major: 0, minor: 7, patch: 2, raw: "0.7.2" });
    expect(() => parseVersion("0.8")).toThrow(/x\.y\.z/);
    expect(() => parseVersion("v0.7.2")).toThrow(/x\.y\.z/);
    expect(() => parseVersion("0.7.2-rc.1")).toThrow(/x\.y\.z/);
  });

  it("classifies the highest changed component", () => {
    const previous = parseVersion("0.7.1");
    expect(classifyBump(previous, parseVersion("0.7.2"))).toBe("patch");
    expect(classifyBump(previous, parseVersion("0.7.10"))).toBe("patch");
    expect(classifyBump(previous, parseVersion("0.8.0"))).toBe("minor");
    expect(classifyBump(previous, parseVersion("0.8.1"))).toBe("minor");
    expect(classifyBump(previous, parseVersion("1.0.0"))).toBe("major");
    expect(classifyBump(previous, parseVersion("1.2.3"))).toBe("major");
    expect(classifyBump(previous, parseVersion("0.7.0"))).toBe("downgrade");
    expect(classifyBump(previous, parseVersion("0.6.9"))).toBe("downgrade");
    expect(classifyBump(previous, previous)).toBe("same");
  });

  it("reads only parenthesized pull request numbers", () => {
    expect(extractPrNumbers("feat: inclusive fork (#10)")).toEqual([10]);
    expect(extractPrNumbers("Merge pull request #5 from openma-ai/example")).toEqual([]);
    expect(extractPrNumbers("chore: refs #10 and (#9) plus (#10)")).toEqual([9, 10]);
  });

  it("does not treat #100 as #10 or #10 as #1", () => {
    expect(mentionsPr("see #100 and #101", 10)).toBe(false);
    expect(mentionsPr("see #10", 1)).toBe(false);
    expect(mentionsPr("landed in #10 (`077db8f`)", 10)).toBe(true);
    expect(missingPrNumbers("#100\n#12", [10, 12, 100])).toEqual([10]);
    expect(missingPrNumbers("#2 is here but not the other", [2, 3, 4])).toEqual([3, 4]);
  });

  it("checks the README pin and leftover unreleased notes", () => {
    expect(readmePinErrors(readme("0.7.2"), "0.7.2")).toEqual([]);
    expect(readmePinErrors(readme("0.7.1"), "0.7.2")).toEqual([
      "README.md pins github:openma-ai/openma-common#v0.7.1, expected #v0.7.2",
    ]);
    expect(readmePinErrors("no pin here", "0.7.2")).toEqual([
      "README.md does not pin github:openma-ai/openma-common#v0.7.2",
    ]);
    expect(unreleasedNoteNames([
      "v0.7.2.md",
      "unreleased-inclusive-fork.md",
      "unreleased-notes.txt",
    ])).toEqual(["unreleased-inclusive-fork.md"]);
  });

  it("allows a patch without a label and requires a label for minor or major", () => {
    expect(bumpLabelErrors("patch", [], "0.7.1", "0.7.2")).toEqual([]);
    expect(bumpLabelErrors("minor", [], "0.7.1", "0.8.0")).toEqual([
      "version 0.7.1 -> 0.8.0 is a minor bump; add the release:minor label or keep the bump to a patch",
    ]);
    expect(bumpLabelErrors("minor", ["release:minor"], "0.7.1", "0.8.0")).toEqual([]);
    expect(bumpLabelErrors("major", ["release:minor"], "0.7.1", "1.0.0")).toEqual([
      "version 0.7.1 -> 1.0.0 is a major bump; add the release:major label or keep the bump to a patch",
    ]);
    expect(bumpLabelErrors("major", ["release:major"], "0.7.1", "1.0.0")).toEqual([]);
    expect(bumpLabelErrors("downgrade", [], "0.7.2", "0.7.1")).toEqual([
      "version 0.7.2 -> 0.7.1 does not increase the version",
    ]);
  });

  it("reports each missing pull request and ignores a complete patch release", () => {
    const common = {
      previousVersion: "0.7.1",
      nextVersion: "0.7.2",
      labels: [] as string[],
      notesPath: "docs/releases/v0.7.2.md",
      readme: readme("0.7.2"),
      unreleasedNames: [] as string[],
      mergedPrNumbers: [10],
      previousTag: "v0.7.1",
      baseRevision: "origin/main",
    };
    expect(evaluateVersionBump({ ...common, notes: "Patch includes #10." })).toEqual([]);
    expect(evaluateVersionBump({ ...common, notes: "Forgot the number." })).toEqual([
      "docs/releases/v0.7.2.md does not mention #10",
    ]);
    expect(evaluateVersionBump({
      ...common,
      notes: null,
      unreleasedNames: ["unreleased-inclusive-fork.md"],
      readme: readme("0.7.1"),
      mergedPrNumbers: [10, 12],
    })).toEqual([
      "docs/releases/v0.7.2.md does not exist",
      "docs/releases/v0.7.2.md does not mention #10",
      "docs/releases/v0.7.2.md does not mention #12",
      "docs/releases/unreleased-inclusive-fork.md must not remain when the package version changes",
      "README.md pins github:openma-ai/openma-common#v0.7.1, expected #v0.7.2",
    ]);
    expect(evaluateVersionBump({
      ...common,
      nextVersion: "0.8.0",
      notes: "#10",
      notesPath: "docs/releases/v0.8.0.md",
      readme: readme("0.8.0"),
    })).toEqual([
      "version 0.7.1 -> 0.8.0 is a minor bump; add the release:minor label or keep the bump to a patch",
    ]);
  });

  it("lists unreleased pull requests as notices without failing on an empty range", () => {
    expect(unreleasedNotices({
      previousTag: "v0.7.1",
      baseRevision: "origin/main",
      commits: [{
        sha: "077db8f6e75a3ca8305c1f7a2978177b14a0d77f",
        subject: "feat(acp-runtime): centralize inclusive message fork support (#10)",
      }],
    })).toEqual([
      "::notice::Unreleased PR #10 on origin/main since v0.7.1: feat(acp-runtime): centralize inclusive message fork support (#10)",
    ]);
    expect(unreleasedNotices({
      previousTag: "v0.7.1",
      baseRevision: "origin/main",
      commits: [{ sha: "abcdef0", subject: "release: v0.7.2" }],
    })).toEqual([
      "::notice::Unreleased commit abcdef0 on origin/main since v0.7.1 has no (#N): release: v0.7.2",
    ]);
    expect(unreleasedNotices({
      previousTag: "v0.7.1",
      baseRevision: "origin/main",
      commits: [],
    })).toEqual([]);
    expect(uniquePrNumbers([
      { sha: "a", subject: "one (#10)" },
      { sha: "b", subject: "two (#10)" },
      { sha: "c", subject: "three (#12)" },
    ])).toEqual([10, 12]);
  });
});
