import { spawn, spawnSync } from "node:child_process";

function run(command) {
  return spawnSync("pnpm", [command], { stdio: "inherit" }).status ?? 1;
}

const linkStatus = run("link:consumers");
if (linkStatus !== 0) process.exit(linkStatus);

let cleaned = false;
function cleanup() {
  if (cleaned) return 0;
  cleaned = true;
  return run("unlink:consumers");
}

const dev = spawn("pnpm", ["dev"], { stdio: "inherit" });
let interrupted = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    interrupted = true;
    dev.kill(signal);
  });
}

process.once("exit", cleanup);

dev.once("error", () => {
  const cleanupStatus = cleanup();
  process.exit(cleanupStatus === 0 ? 1 : cleanupStatus);
});

dev.once("exit", (code) => {
  const cleanupStatus = cleanup();
  if (cleanupStatus !== 0) process.exit(cleanupStatus);
  process.exit(interrupted ? 0 : (code ?? 1));
});
