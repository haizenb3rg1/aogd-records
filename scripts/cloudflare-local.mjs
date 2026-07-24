import { execFileSync, spawn } from "node:child_process";
import { copyFile, readFile, unlink } from "node:fs/promises";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "wrangler.local.jsonc");
const temporary = path.join(root, "wrangler.jsonc");
const wranglerEntry = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const mode = process.argv[2];

if (!["migrate", "dev"].includes(mode)) {
  console.error("Usage: node scripts/cloudflare-local.mjs migrate|dev");
  process.exit(2);
}

if (existsSync(temporary)) {
  const current = await readFile(temporary, "utf8");
  const local = await readFile(source, "utf8");
  if (current !== local) {
    console.error("Refusing to overwrite an existing wrangler.jsonc. Move it away and retry.");
    process.exit(1);
  }
} else {
  await copyFile(source, temporary);
}

let cleaning = false;
async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  await unlink(temporary).catch(() => {});
}

const wranglerArgs = mode === "migrate"
  ? ["d1", "migrations", "apply", "aogd-records-local", "--local"]
  : ["pages", "dev", "dist"];
const child = spawn(process.execPath, [wranglerEntry, ...wranglerArgs], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});

function terminateChild(signal) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      child.kill();
    }
  } else {
    child.kill(signal);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    terminateChild(signal);
  });
}
process.on("exit", () => {
  try { unlinkSync(temporary); } catch {}
});

const exitCode = await new Promise((resolve) => {
  child.once("exit", (code) => resolve(code ?? 1));
  child.once("error", () => resolve(1));
});
await cleanup();
process.exit(exitCode);
