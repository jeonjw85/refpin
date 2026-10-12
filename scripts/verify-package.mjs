import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "Run this verifier with npm run test:package");
const temporary = mkdtempSync(join(tmpdir(), "refpin-package-"));

function npm(args, cwd, capture = false) {
  // Materialize the temporary tarball and install even under npm publish --dry-run.
  return execFileSync(process.execPath, [npmCli, "--dry-run=false", ...args], {
    cwd, encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

try {
  const [packed] = JSON.parse(npm([
    "pack", "--ignore-scripts", "--json", "--pack-destination", temporary,
  ], root, true));
  assert.equal(packed.name, "refpin", "The distribution must use the release package name");

  const files = new Set(packed.files.map((file) => file.path));
  for (const required of [
    "package.json", "README.md", "README.ko.md", "LICENSE",
    "dist/esm/index.js", "dist/esm/index.d.ts", "dist/cjs/index.js",
    "dist/cjs/index.d.ts", "dist/cjs/package.json",
  ]) assert.ok(files.has(required), `Missing distribution file: ${required}`);
  for (const file of files) {
    assert.ok(["package.json", "README.md", "README.ko.md", "LICENSE", "dist/cjs/package.json"].includes(file) ||
      /^dist\/(esm|cjs)\/.+\.(js|d\.ts)$/.test(file), `Unexpected distribution file: ${file}`);
  }

  const consumer = join(temporary, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  npm(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false",
    join(temporary, packed.filename)], consumer);

  const installed = JSON.parse(readFileSync(join(consumer, "node_modules/refpin/package.json"), "utf8"));
  assert.equal(installed.license, "MIT");
  assert.deepEqual(installed.dependencies ?? {}, {}, "The package must have no runtime dependencies");

  // Run the same contract from an independent consumer, not package self-resolution.
  copyFileSync(join(root, "test/package.test.mjs"), join(consumer, "package.test.mjs"));
  execFileSync(process.execPath, ["--test", "package.test.mjs"], { cwd: consumer, stdio: "inherit" });

  mkdirSync(join(consumer, "types"));
  for (const file of ["consumer.mts", "consumer.cts", "tsconfig.json"]) {
    copyFileSync(join(root, "test/types", file), join(consumer, "types", file));
  }
  const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  execFileSync(process.execPath, [tsc, "-p", "types/tsconfig.json"], { cwd: consumer, stdio: "inherit" });
  console.log(`Verified installed ${packed.name}@${packed.version}: ESM, CommonJS, and TypeScript.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
