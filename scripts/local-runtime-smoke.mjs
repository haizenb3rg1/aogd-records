import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const root = new URL("../", import.meta.url);
const persistDir = await mkdtemp(path.join(tmpdir(), "aogd-runtime-"));
const runtimeEnv = {
  ...process.env,
  AOGD_LOCAL_DISABLE_R2: "1",
  AOGD_LOCAL_PERSIST_TO: persistDir,
  AOGD_LOCAL_TEST_BINDINGS: "1",
};
const migration = spawnSync(process.execPath, ["scripts/cloudflare-local.mjs", "migrate"], {
  cwd: root,
  env: runtimeEnv,
  encoding: "utf8",
  windowsHide: true,
});
if (migration.status !== 0) {
  await rm(persistDir, { recursive: true, force: true });
  throw new Error(`Local D1 migration failed.\n${migration.stdout || ""}\n${migration.stderr || ""}`);
}
const wranglerEntry = path.join(path.resolve(import.meta.dirname, ".."), "node_modules", "wrangler", "bin", "wrangler.js");
const wranglerConfig = path.join(path.resolve(import.meta.dirname, ".."), "wrangler.local.jsonc");
const seed = spawnSync(process.execPath, [
  wranglerEntry,
  "d1", "execute", "aogd-records-local", "--local",
  "--config", wranglerConfig,
  "--persist-to", persistDir,
  "--command",
  "INSERT INTO users (id,email,nickname,password_hash,password_salt,password_iterations,verified_at,created_at,updated_at) VALUES ('runtime-verified-user','verified-runtime@example.invalid','RuntimeVerified','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=','AAAAAAAAAAAAAAAAAAAAAA==',600000,'2026-07-24T00:00:00.000Z','2026-07-24T00:00:00.000Z','2026-07-24T00:00:00.000Z');",
], {
  cwd: root,
  env: runtimeEnv,
  encoding: "utf8",
  windowsHide: true,
});
if (seed.status !== 0) {
  await rm(persistDir, { recursive: true, force: true });
  throw new Error(`Local D1 seed failed.\n${seed.stdout || ""}\n${seed.stderr || ""}`);
}

const server = spawn(process.execPath, ["scripts/cloudflare-local.mjs", "dev"], {
  cwd: root,
  env: runtimeEnv,
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
  const missingApi = await fetch("http://127.0.0.1:8788/api/__missing_runtime_route__");
  const missingPage = await fetch("http://127.0.0.1:8788/__missing_runtime_page__");
  const securityText = await fetch("http://127.0.0.1:8788/.well-known/security.txt");
  const securityRedirect = await fetch("http://127.0.0.1:8788/security.txt", { redirect: "manual" });
  const robots = await fetch("http://127.0.0.1:8788/robots.txt");
  const sitemap = await fetch("http://127.0.0.1:8788/sitemap.xml");
  const invalidJsonShape = await fetch("http://127.0.0.1:8788/api/account/resend-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "null",
  });
  const encodedJson = await fetch("http://127.0.0.1:8788/api/account/resend-code", {
    method: "POST",
    headers: {
      "Content-Encoding": "gzip",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const verifiedUserBypass = await fetch("http://127.0.0.1:8788/api/account/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "verified-runtime@example.invalid",
      code: "000000",
    }),
  });
  const supportForm = new FormData();
  supportForm.set("agreement", "true");
  supportForm.set("email", "runtime-support@example.invalid");
  supportForm.set("category", "technical");
  supportForm.set("subject", "Runtime smoke request");
  supportForm.set("description", "Runtime smoke request that verifies the guest support path.");
  const guestSupport = await fetch("http://127.0.0.1:8788/api/support", {
    method: "POST",
    body: supportForm,
  });

  assert.equal(records.status, 200);
  assert.equal(leaderboard.status, 200);
  assert.equal(account.status, 200);
  assert.equal(adminSecurity.status, 401);
  assert.equal(missingApi.status, 404);
  assert.equal(missingPage.status, 404);
  assert.equal(securityText.status, 200);
  assert.equal(securityRedirect.status, 301);
  assert.equal(robots.status, 200);
  assert.equal(sitemap.status, 200);
  assert.equal(invalidJsonShape.status, 400);
  assert.equal(encodedJson.status, 415);
  assert.equal(verifiedUserBypass.status, 400);
  assert.equal(guestSupport.status, 201);
  assert.match(records.headers.get("content-type") || "", /^application\/json\b/);
  assert.equal(records.headers.get("cache-control"), "public, max-age=30, must-revalidate");
  assert.equal(records.headers.get("x-content-type-options"), "nosniff");
  assert.equal(records.headers.has("access-control-allow-origin"), false);
  assert.equal(Object.hasOwn(await records.json(), "records"), true);
  assert.equal(Object.hasOwn(await leaderboard.json(), "leaders"), true);
  assert.match(missingApi.headers.get("content-type") || "", /^application\/json\b/);
  assert.equal((await missingApi.json()).code, "not_found");
  assert.match(missingPage.headers.get("content-type") || "", /^text\/html\b/);
  assert.match(await securityText.text(), /^Contact:/m);
  assert.equal(securityRedirect.headers.get("location"), "/.well-known/security.txt");
  assert.match(await robots.text(), /Disallow: \/api\//);
  assert.match(sitemap.headers.get("content-type") || "", /(?:application|text)\/xml/);
  assert.equal((await invalidJsonShape.json()).code, "invalid_json");
  assert.equal((await encodedJson.json()).code, "unsupported_content_encoding");
  assert.equal((await verifiedUserBypass.json()).code, "invalid_code");
  assert.match((await guestSupport.json()).request.id, /^[0-9a-f-]{36}$/i);

  console.log("Local Pages runtime smoke tests passed.");
} finally {
  await stopRuntime();
  await rm(persistDir, { recursive: true, force: true });
}
