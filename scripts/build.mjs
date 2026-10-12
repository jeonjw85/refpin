import { rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
await rm(new URL("../dist/", import.meta.url), { recursive: true, force: true });

for (const config of ["tsconfig.json", "tsconfig.cjs.json"]) {
  const result = spawnSync(process.execPath, [tsc, "-p", config], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

await writeFile(new URL("../dist/cjs/package.json", import.meta.url), '{"type":"commonjs"}\n');
