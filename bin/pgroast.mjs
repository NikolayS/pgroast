#!/usr/bin/env node
// Launcher for `npx pgroast`. PG Roast is written for Bun (TypeScript sources, Bun.sql), so this
// small Node script handles fast --version checks directly and hands everything else to `bun`.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

if (args.length === 1 && (args[0] === "-V" || args[0] === "-v" || args[0] === "--version" || args[0] === "version")) {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    console.log(`pgroast ${pkg.version || "0.0.0"}`);
    process.exit(0);
  } catch {
    // fall through to bun
  }
}

const bun = process.env.PGROAST_BUN_BIN || "bun";
const r = spawnSync(bun, ["run", join(root, "src", "cli.ts"), ...args], { stdio: "inherit" });
if (r.error) {
  if (r.error.code === "ENOENT") {
    console.error("pgroast needs Bun 1.3.5 or later (https://bun.sh), and `bun` was not found on PATH.\nInstall it, for example: curl -fsSL https://bun.sh/install | bash\nOr run it directly with: bunx pgroast ...");
    process.exit(127);
  }
  console.error(`pgroast: could not start bun: ${r.error.message}`);
  process.exit(1);
}
process.exit(r.status ?? 1);
