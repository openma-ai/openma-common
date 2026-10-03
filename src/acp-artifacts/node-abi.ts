import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Cache directory segment that isolates npm installs by Node module ABI. */
export async function nodeModulesCacheKey(nodePath?: string): Promise<string> {
  if (!nodePath) return `node${process.versions.modules}`;
  const { stdout } = await exec(nodePath, ["-p", "process.versions.modules"], {
    timeout: 30_000,
    maxBuffer: 1024,
  });
  const modules = stdout.trim();
  if (!/^\d+$/.test(modules)) throw new Error("Invalid Node module ABI from nodePath");
  return `node${modules}`;
}
