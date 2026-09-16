import { copyFile, mkdir } from "node:fs/promises";

await mkdir("dist/brand", { recursive: true });
await mkdir("dist/chat-ui", { recursive: true });
await Promise.all([
  copyFile("src/brand/tokens.css", "dist/brand/tokens.css"),
  copyFile("src/brand/website.css", "dist/brand/website.css"),
  copyFile("src/brand/openma-logo-mark.svg", "dist/brand/openma-logo-mark.svg"),
  copyFile("src/chat-ui/styles.css", "dist/chat-ui/styles.css"),
]);
