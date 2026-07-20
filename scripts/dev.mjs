import { spawn } from "node:child_process";
import { cp, mkdir, watch } from "node:fs/promises";

const staticAssets = ["tokens.css", "openma-logo-mark.svg"];

async function copyStaticAssets(filename) {
  if (filename && !staticAssets.includes(filename)) return;
  await mkdir("dist/brand", { recursive: true });
  const selected = filename ? [filename] : staticAssets;
  await Promise.all(selected.map((name) => cp(`src/brand/${name}`, `dist/brand/${name}`)));
}

await copyStaticAssets();

const compiler = spawn(
  "pnpm",
  ["exec", "tsc", "-p", "tsconfig.build.json", "--watch", "--preserveWatchOutput"],
  { stdio: "inherit" },
);

const watcher = watch("src/brand");
void (async () => {
  for await (const event of watcher) {
    try {
      await copyStaticAssets(event.filename);
    } catch (error) {
      console.error("Failed to copy a static brand asset", error);
    }
  }
})();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    compiler.kill(signal);
    process.exit(0);
  });
}

compiler.on("exit", (code) => process.exit(code ?? 0));
