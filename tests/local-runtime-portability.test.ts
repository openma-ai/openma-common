/** Regression boundary: cloud adapters may consume the local core, never vice versa.
 * Runtime behavior uses the REAL public-entry host + ACP client and SDK transport.
 * Only the remote ACP agent and generic disk checkpoint adapter are fixtures.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const fixtures = join(root, "tests/fixtures/local-portability");

// AST traversal intentionally includes type imports, inline import types,
// reexports, import(), require(), and createRequire results. Nonliteral loading
// fails closed rather than silently disappearing from the graph.
function specifiers(text: string, filename: string): string[] {
  const ast = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const result: string[] = [];
  const requireNames = new Set(["require"]);
  const createRequireNames = new Set(["createRequire"]);
  const collectAliases = (node: ts.Node): void => {
    if (ts.isImportSpecifier(node) && (node.propertyName?.text ?? node.name.text) === "createRequire") createRequireNames.add(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      const expression = node.initializer.expression;
      if ((ts.isIdentifier(expression) && createRequireNames.has(expression.text)) ||
          (ts.isPropertyAccessExpression(expression) && expression.name.text === "createRequire")) requireNames.add(node.name.text);
    }
    ts.forEachChild(node, collectAliases);
  };
  collectAliases(ast);
  const add = (node: ts.Node | undefined) => {
    if (!node || !ts.isStringLiteralLike(node)) throw new Error(`${filename}: nonliteral module load needs an explicit graph resolver`);
    result.push(node.text);
  };
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) add(node.moduleSpecifier);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(callee) && requireNames.has(callee.text)) ||
          (ts.isPropertyAccessExpression(callee) && callee.name.text === "require")) add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return result;
}

const forbidden = (name: string) => /(?:^|\/)(?:managed-runtime|harness-runtime-acp|environment-work[^/]*|control-plane[^/]*|session-runtime|session-do|SessionDO)(?:\/|$)|cloudflare:|@cloudflare\/|@aws-sdk\/|@azure\/|@google-cloud\/|(?:^|\/)(?:work-[^/]*|sql[^/]*)(?:\/|$)/i.test(name);
function graph(entry: string) {
  const files = new Set<string>(), externals = new Set<string>();
  const visit = (file: string, chain: string[]) => {
    if (files.has(file)) return;
    files.add(file);
    for (const specifier of specifiers(readFileSync(file, "utf8"), relative(root, file))) {
      const path = [...chain, relative(root, file), specifier].join(" -> ");
      if (forbidden(specifier)) throw new Error(`Cloud dependency in local core: ${path}`);
      let target: string | undefined;
      if (specifier.startsWith(".")) target = resolve(dirname(file), specifier);
      else if (specifier.startsWith("@openma/common/")) target = join(src, specifier.slice("@openma/common/".length), "index.ts");
      else externals.add(specifier);
      if (!target) continue;
      target = target.replace(/\.js$/, ".ts");
      if (forbidden(relative(src, target))) throw new Error(`Cloud dependency in local core: ${path}`);
      if (!existsSync(target)) throw new Error(`Unresolved graph edge: ${path}`);
      visit(target, [...chain, relative(root, file)]);
    }
  };
  visit(entry, []);
  return { files, externals };
}

describe("local runtime portability (no cloud control plane)", () => {
  it("runs prompt, steer, permission, cancel and disk/native restart through public entries in a credential-free process", async () => {
    const temp = realpathSync(mkdtempSync(join(tmpdir(), "openma-local-portability-")));
    try {
      // Node permissions deny reads outside immutable source/dependencies and
      // this run's temporary directory. No home, credentials, SQL or Work store.
      const args = [
        "--permission", "--experimental-transform-types", "--disable-warning=ExperimentalWarning",
        `--allow-fs-read=${src}`, `--allow-fs-read=${fixtures}`,
        `--allow-fs-read=${realpathSync(join(root, "node_modules"))}`,
        `--allow-fs-read=${join(root, "package.json")}`, `--allow-fs-read=${temp}`,
        `--allow-fs-write=${temp}`,
        join(fixtures, "bootstrap.mjs"),
      ];
      const options = { cwd: temp, env: { HOME: temp, TMPDIR: temp, NODE_ENV: "test" }, timeout: 15_000, maxBuffer: 1_000_000 };
      const { stdout, stderr } = await promisify(execFile)(process.execPath, args, options);
      expect(stderr).toBe("");
      const result = JSON.parse(stdout.trim());
      expect(result).toMatchObject({ ok: true, phase: "initial", spawns: 2, newSessions: 2, loads: 0, cancellations: 1 });
      expect(result.checks).toEqual(['no-credentials', 'fs-permission', 'no-child-process', 'no-network', 'minimal-no-checkpoint', 'prompt', 'steer', 'permission', 'cancel', 'checkpoint']);
      const restarted = await promisify(execFile)(process.execPath, [...args, 'restart'], options);
      expect(restarted.stderr).toBe('');
      expect(JSON.parse(restarted.stdout.trim())).toMatchObject({
        ok: true, phase: 'restart', spawns: 1, newSessions: 0, loads: 1, trace: ['prompt:recall'],
      });
    } finally { rmSync(temp, { recursive: true, force: true }); }
  }, 20_000);

  it.each(["local-runtime", "acp-runtime"])("%s public entry has no static, type or dynamic dependency on managed HTTP/Work/SQL/cloud", entry => {
    // Verify source under test is the entry the package actually exports.
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(manifest.exports[`./${entry}`].import).toBe(`./dist/${entry}/index.js`);
    const found = graph(join(src, entry, "index.ts"));
    expect(found.files.has(join(src, entry, "index.ts"))).toBe(true);
    // Unlike the old static-only test, the lazy probe spawner MUST be visited.
    if (entry === "acp-runtime") {
      expect(found.files.has(join(src, "acp-runtime/spawners/node.ts"))).toBe(true);
      expect(found.externals.has("node:child_process")).toBe(true);
    }
  });

  it("graph parser catches multiline/dynamic/type/createRequire edges and rejects unknown computed imports", () => {
    expect(specifiers(`
      import type { Scope } from '../managed-runtime/contracts.js';
      export { x } from './plain.js';
      const a = import(/* lazy */ '../managed-runtime/http-control.js');
      const b = import(\`../managed-runtime/claimed-environment-work.js\`);
      type T = import('../managed-runtime/contracts.js').RuntimeResourceScope;
      import { createRequire as makeRequire } from 'node:module';
      const load = makeRequire(import.meta.url);
      load('../managed-runtime/index.js');
      require('../managed-runtime/control-input-plan.js');
    `, "parser-fixture.ts")).toEqual([
      '../managed-runtime/contracts.js', './plain.js', '../managed-runtime/http-control.js',
      '../managed-runtime/claimed-environment-work.js', '../managed-runtime/contracts.js',
      'node:module', '../managed-runtime/index.js', '../managed-runtime/control-input-plan.js',
    ]);
    expect(() => specifiers('import(prefix + name)', 'computed.ts')).toThrow(/nonliteral/);
    expect(() => specifiers('require(name)', 'computed.ts')).toThrow(/nonliteral/);
  });

  it("rejects a transitive lazy managed edge, while permitting ordinary Node filesystem/spawner imports", () => {
    const temp = mkdtempSync(join(tmpdir(), "openma-portability-graph-"));
    // In-memory mutation fixture, never edit production modules to prove guard.
    const read = specifiers("import('node:fs/promises'); import('node:child_process');", "allowed.ts");
    expect(read.some(forbidden)).toBe(false);
    try {
      // Files are needed to test traversal, not just the edge classifier.
      writeFileSync(join(temp, "entry.ts"), "export * from './hop.js'");
      writeFileSync(join(temp, "hop.ts"), "const lazy = () => import('../managed-runtime/http-control.js')");
      expect(() => graph(join(temp, "entry.ts"))).toThrow(/Cloud dependency.*entry\.ts.*hop\.ts.*http-control/);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });

  it("managed composition imports and invokes the same public local core rather than introducing another ACP loop", () => {
    const file = join(src, "managed-runtime/index.ts");
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const factories = new Set<string>();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== '../local-runtime/index.js') continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
        if ((item.propertyName?.text ?? item.name.text) === 'createManagedAgentsRuntime') factories.add(item.name.text);
      }
    }
    let factoryCalls = 0;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && factories.has(node.expression.text)) factoryCalls++;
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(factories.size).toBe(1); expect(factoryCalls).toBeGreaterThan(0);
  });
});
