import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const config = path.join(root, "wrangler.local.jsonc");
const wranglerEntry = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const mode = process.argv[2];
const port = process.env.AOGD_LOCAL_PORT || "8788";
const persistTo = process.env.AOGD_LOCAL_PERSIST_TO || "";
const testBindings = process.env.AOGD_LOCAL_TEST_BINDINGS === "1"
  ? [
      "--binding", `RATE_LIMIT_SECRET=${crypto.randomUUID()}`,
      "--binding", `CODE_PEPPER=${crypto.randomUUID()}`,
    ]
  : [];

if (!["migrate", "dev"].includes(mode)) {
  console.error("Usage: node scripts/cloudflare-local.mjs migrate|dev");
  process.exit(2);
}

const wranglerArgs = mode === "migrate"
  ? [
      "d1", "migrations", "apply", "aogd-records-local", "--local", "--config", config,
      ...(persistTo ? ["--persist-to", persistTo] : []),
    ]
  : [
      "pages", "dev", "dist",
      "--d1", "DB=00000000-0000-0000-0000-000000000000",
      ...(process.env.AOGD_LOCAL_DISABLE_R2 === "1" ? [] : ["--r2", "MEDIA=aogd-records-media-local"]),
      "--compatibility-date", "2026-07-23",
      "--port", port,
      "--show-interactive-dev-session", "false",
      ...testBindings,
      ...(persistTo ? ["--persist-to", persistTo] : []),
    ];
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
const exitCode = await new Promise((resolve) => {
  child.once("exit", (code) => resolve(code ?? 1));
  child.once("error", () => resolve(1));
});
process.exit(exitCode);
