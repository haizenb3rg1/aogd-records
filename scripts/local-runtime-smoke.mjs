import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import process from "node:process";

const root = new URL("../", import.meta.url);
const server = spawn(process.execPath, ["scripts/cloudflare-local.mjs", "dev"], {
  cwd: root,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let output = "";
for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-12000);
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForRuntime() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Pages runtime exited early.\n${output}`);
    try {
      const response = await fetch("http://127.0.0.1:8788/api/records");
      if (response.ok) return response;
    } catch {}
    await delay(250);
  }
  throw new Error(`Pages runtime did not become ready.\n${output}`);
}

async function stopRuntime() {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    delay(5000),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

try {
  const records = await waitForRuntime();
  const leaderboard = await fetch("http://127.0.0.1:8788/api/leaderboard");
  const account = await fetch("http://127.0.0.1:8788/api/account/me");
  const adminSecurity = await fetch("http://127.0.0.1:8788/api/admin/security");

  assert.equal(records.status, 200);
  assert.equal(leaderboard.status, 200);
  assert.equal(account.status, 200);
  assert.equal(adminSecurity.status, 401);
  assert.match(records.headers.get("content-type") || "", /^application\/json\b/);
  assert.equal(records.headers.get("cache-control"), "no-store");
  assert.equal(records.headers.get("x-content-type-options"), "nosniff");
  assert.equal(Object.hasOwn(await records.json(), "records"), true);
  assert.equal(Object.hasOwn(await leaderboard.json(), "leaders"), true);

  console.log("Local Pages runtime smoke tests passed.");
} finally {
  await stopRuntime();
}
