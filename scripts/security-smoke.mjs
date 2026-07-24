import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import {
  assertAllowedSearchParams,
  assertSameOrigin,
  configurationStatus,
  hashPassword,
  safeError,
  validateImageFile,
  verifyPassword,
} from "../functions/_lib/security.js";
import { storeEmailCode } from "../functions/api/account/[[path]].js";

const root = new URL("../", import.meta.url);

function asD1(database) {
  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      let bindings = [];
      const prepared = {
        bind(...values) {
          bindings = values;
          return prepared;
        },
        first() {
          return statement.get(...bindings) || null;
        },
        run() {
          const result = statement.run(...bindings);
          return { meta: { changes: Number(result.changes || 0) } };
        },
      };
      return prepared;
    },
    batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

async function testMigrations() {
  const database = new DatabaseSync(":memory:");
  for (const name of [
    "0001_init.sql",
    "0002_accounts_support.sql",
    "0003_security_hardening.sql",
    "0004_reception.sql",
    "0005_staff_roles_presence.sql",
    "0006_privacy_and_owner_invariants.sql",
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
  database.prepare(`
    INSERT INTO staff_assignments (user_id, role_slug, assigned_at, assigned_by)
    VALUES ('user-a', 'owner', ?, 'test')
  `).run(now);
  assert.throws(
    () => database.prepare("DELETE FROM staff_assignments WHERE user_id = 'user-a' AND role_slug = 'owner'").run(),
    /last_owner/,
  );
  database.prepare(`
    INSERT INTO staff_assignments (user_id, role_slug, assigned_at, assigned_by)
    VALUES ('user-b', 'owner', ?, 'test')
  `).run(now);
  database.prepare("DELETE FROM staff_assignments WHERE user_id = 'user-a' AND role_slug = 'owner'").run();
  assert.equal(
    database.prepare("SELECT COUNT(*) AS total FROM staff_assignments WHERE role_slug = 'owner'").get().total,
    1,
  );
  assert.throws(() => database.prepare("DELETE FROM users WHERE id = 'user-b'").run(), /last_owner/);
  assert.throws(() => database.prepare(`
    INSERT INTO staff_presence (user_id, visible, updated_at) VALUES ('user-a', 2, ?)
  `).run(now));

  const issuanceEnv = { DB: asD1(database), CODE_PEPPER: "test-only-code-pepper" };
  const concurrentIssuance = await Promise.allSettled([
    storeEmailCode(issuanceEnv, "user-a", "verify"),
    storeEmailCode(issuanceEnv, "user-a", "verify"),
  ]);
  assert.equal(concurrentIssuance.filter(({ status }) => status === "fulfilled").length, 1);
  const rejectedIssuance = concurrentIssuance.find(({ status }) => status === "rejected");
  assert.equal(rejectedIssuance?.reason?.code, "code_cooldown");
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) AS total
      FROM email_codes
      WHERE user_id = 'user-a' AND purpose = 'verify' AND used_at IS NULL
    `).get().total,
    1,
  );

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

function testQueryAllowlist() {
  assert.doesNotThrow(() =>
    assertAllowedSearchParams(new Request("https://aogd.site/api/records?page=2"), ["page"]),
  );
  assert.throws(() =>
    assertAllowedSearchParams(new Request("https://aogd.site/api/records?page=2&cachebust=1"), ["page"]),
  );
  assert.throws(() =>
    assertAllowedSearchParams(new Request("https://aogd.site/api/records?page=2&page=3"), ["page"]),
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
  const pngBytes = Uint8Array.from(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ));
  const validPng = {
    name: "avatar.png",
    type: "image/png",
    size: pngBytes.byteLength,
    arrayBuffer: async () => pngBytes.buffer,
  };
  const spoofed = {
    ...validPng,
    arrayBuffer: async () => new TextEncoder().encode("<script>").buffer,
  };
  const wrongMime = { ...validPng, type: "image/jpeg" };
  const oversizedDimensions = pngBytes.slice();
  new DataView(oversizedDimensions.buffer).setUint32(16, 5000);
  new DataView(oversizedDimensions.buffer).setUint32(20, 5000);
  const oversized = {
    ...validPng,
    arrayBuffer: async () => oversizedDimensions.buffer,
  };
  const ihdrEnd = 33;
  const animationChunk = Uint8Array.from([
    0, 0, 0, 8, 0x61, 0x63, 0x54, 0x4c,
    0, 0, 0, 2, 0, 0, 0, 0,
    0, 0, 0, 0,
  ]);
  const animatedBytes = new Uint8Array(pngBytes.length + animationChunk.length);
  animatedBytes.set(pngBytes.slice(0, ihdrEnd), 0);
  animatedBytes.set(animationChunk, ihdrEnd);
  animatedBytes.set(pngBytes.slice(ihdrEnd), ihdrEnd + animationChunk.length);
  const animated = {
    ...validPng,
    size: animatedBytes.byteLength,
    arrayBuffer: async () => animatedBytes.buffer,
  };
  assert.equal(await validateImageFile(validPng, 1024), validPng);
  await assert.rejects(() => validateImageFile(spoofed, 1024));
  await assert.rejects(() => validateImageFile(wrongMime, 1024));
  await assert.rejects(() => validateImageFile(oversized, 1024));
  await assert.rejects(() => validateImageFile(animated, 1024));
}

function testConfigurationStatus() {
  const secrets = {
    ADMIN_TOKEN: "admin-token-that-must-never-leak",
    ADMIN_TOTP_SECRET: "totp-secret-that-must-never-leak",
    RATE_LIMIT_SECRET: "rate-limit-secret-that-must-never-leak",
    CODE_PEPPER: "code-pepper-that-must-never-leak",
    RESEND_API_KEY: "resend-key-that-must-never-leak",
    EMAIL_FROM: "A.O.G.D <support@example.test>",
    SUPPORT_EMAIL: "inbox@example.test",
    TURNSTILE_SECRET_KEY: "turnstile-secret-that-must-never-leak",
  };
  const complete = configurationStatus({ DB: {}, MEDIA: {}, ...secrets });
  assert.deepEqual(complete, {
    database: true,
    mediaStorage: true,
    adminToken: true,
    adminSecondFactor: true,
    dedicatedRateLimitSecret: true,
    dedicatedCodePepper: true,
    emailDelivery: true,
    supportNotifications: true,
    turnstileServer: true,
  });
  const serialized = JSON.stringify(complete);
  for (const value of Object.values(secrets)) assert.equal(serialized.includes(value), false);

  assert.deepEqual(configurationStatus({ DB: {} }), {
    database: true,
    mediaStorage: false,
    adminToken: false,
    adminSecondFactor: false,
    dedicatedRateLimitSecret: false,
    dedicatedCodePepper: false,
    emailDelivery: false,
    supportNotifications: false,
    turnstileServer: false,
  });
}

await testMigrations();
await testPasswords();
testOriginProtection();
testQueryAllowlist();
await testSafeErrors();
await testImageSignature();
testConfigurationStatus();
console.log("Security smoke tests passed.");
