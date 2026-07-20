import { cp, mkdir } from "node:fs/promises";

await mkdir("dist/brand", { recursive: true });
await Promise.all([
  cp("src/brand/tokens.css", "dist/brand/tokens.css"),
  cp("src/brand/openma-logo-mark.svg", "dist/brand/openma-logo-mark.svg"),
]);
