import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import {
  assertSameOrigin,
  hashPassword,
  safeError,
  validateImageFile,
  verifyPassword,
} from "../functions/_lib/security.js";

const root = new URL("../", import.meta.url);

async function testMigrations() {
  const database = new DatabaseSync(":memory:");
  for (const name of [
    "0001_init.sql",
    "0002_accounts_support.sql",
    "0003_security_hardening.sql",
    "0004_reception.sql",
    "0005_staff_roles_presence.sql",
  ]) {
    database.exec(await readFile(new URL(`migrations/${name}`, root), "utf8"));
  }

  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map(({ name }) => name);
  for (const table of [
    "records",
    "users",
    "user_sessions",
    "email_codes",
    "support_requests",
    "admin_sessions",
    "rate_limits",
    "admin_audit_log",
    "reception_threads",
    "reception_interests",
    "account_numbers",
    "staff_roles",
    "staff_assignments",
    "staff_presence",
  ]) {
    assert.ok(tables.includes(table), `Missing table: ${table}`);
  }

  const userColumns = database.prepare("PRAGMA table_info(users)").all().map(({ name }) => name);
  assert.ok(userColumns.includes("password_iterations"));
  assert.ok(userColumns.includes("disabled_at"));

  const now = new Date().toISOString();
  const insertUser = database.prepare(`
    INSERT INTO users (
      id, email, nickname, password_hash, password_salt, password_iterations,
      verified_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'hash', 'salt', 600000, ?, ?, ?)
  `);
  insertUser.run("user-a", "a@example.test", "UserA", now, now, now);
  insertUser.run("user-b", "b@example.test", "UserB", now, now, now);
  const accountNumbers = database.prepare(`
    SELECT user_id, id FROM account_numbers
    WHERE user_id IN ('user-a', 'user-b')
    ORDER BY id ASC
  `).all();
  assert.equal(accountNumbers.length, 2);
  assert.equal(accountNumbers[1].id, accountNumbers[0].id + 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS total FROM staff_roles WHERE is_system = 1").get().total, 7);
  database.prepare(`
    INSERT INTO staff_assignments (user_id, role_slug, assigned_at, assigned_by)
    VALUES ('user-a', 'support', ?, 'test')
  `).run(now);
  assert.equal(database.prepare("SELECT role_slug FROM staff_assignments WHERE user_id = 'user-a'").get().role_slug, "support");
  assert.throws(() => database.prepare(`
    INSERT INTO staff_presence (user_id, visible, updated_at) VALUES ('user-a', 2, ?)
  `).run(now));

  const invalidVisibility = database.prepare(`
    INSERT INTO reception_threads (
      id, user_id, category, title, body, visibility, is_anonymous, status,
      consent_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?, ?)
  `);
  assert.throws(() => invalidVisibility.run(
    crypto.randomUUID(),
    "missing-user",
    "question",
    "Проверочный вопрос",
    "Достаточно длинное проверочное описание обращения.",
    "secret",
    "test",
    new Date().toISOString(),
    new Date().toISOString(),
  ));

  const privateCategory = database.prepare(`
    INSERT INTO reception_threads (
      id, user_id, category, title, body, visibility, is_anonymous, status,
      consent_version, created_at, updated_at
    ) VALUES (?, ?, 'security', ?, ?, 'public', 0, 'pending', ?, ?, ?)
  `);
  assert.throws(() => privateCategory.run(
    crypto.randomUUID(),
    "missing-user",
    "Проверка ограничения категории",
    "Сообщение о безопасности не должно обходить обязательную приватность.",
    "test",
    new Date().toISOString(),
    new Date().toISOString(),
  ));
  database.close();
}

async function testPasswords() {
  const password = "Long-security-passphrase-42!";
  const stored = await hashPassword(password);
  assert.equal(stored.iterations, 600000);
  assert.equal(await verifyPassword(password, stored.hash, stored.salt, stored.iterations), true);
  assert.equal(await verifyPassword("wrong-password", stored.hash, stored.salt, stored.iterations), false);
}

function testOriginProtection() {
  assert.doesNotThrow(() =>
    assertSameOrigin(
      new Request("https://aogd.site/api/example", {
        method: "POST",
        headers: { Origin: "https://aogd.site", "Sec-Fetch-Site": "same-origin" },
      }),
    ),
  );
  assert.throws(() =>
    assertSameOrigin(
      new Request("https://aogd.site/api/example", {
        method: "POST",
        headers: { Origin: "https://attacker.invalid", "Sec-Fetch-Site": "cross-site" },
      }),
    ),
  );
}

async function testSafeErrors() {
  const previousConsoleError = console.error;
  console.error = () => {};
  const response = safeError(
    new Error("SQLITE_INTERNAL super-secret stack detail"),
    new Request("https://aogd.site/api/example"),
  );
  console.error = previousConsoleError;
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.equal(body.error, "Не удалось выполнить запрос.");
  assert.equal(JSON.stringify(body).includes("SQLITE_INTERNAL"), false);
  assert.ok(body.requestId);
}

async function testImageSignature() {
  const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const validPng = {
    name: "avatar.png",
    type: "image/png",
    size: 12,
    arrayBuffer: async () => pngBytes.buffer,
    slice: () => ({ arrayBuffer: async () => pngBytes.buffer }),
  };
  const spoofed = {
    ...validPng,
    slice: () => ({ arrayBuffer: async () => new TextEncoder().encode("<script>").buffer }),
  };
  assert.equal(await validateImageFile(validPng, 1024), validPng);
  await assert.rejects(() => validateImageFile(spoofed, 1024));
}

await testMigrations();
await testPasswords();
testOriginProtection();
await testSafeErrors();
await testImageSignature();
console.log("Security smoke tests passed.");
