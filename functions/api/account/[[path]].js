import {
  ApiError,
  assertSameOrigin,
  cleanupExpired,
  clearSessionCookie,
  enforceRateLimit,
  enforceSubjectRateLimit,
  getCurrentUser,
  hashPassword,
  hmacSha256,
  isValidEmail,
  isValidNickname,
  json,
  normalizeEmail,
  normalizeNickname,
  parseCookies,
  randomCode,
  randomToken,
  readJson,
  requestId,
  requireDatabase,
  safeError,
  sendEmail,
  sessionCookie,
  sha256,
  timingSafeEqual,
  verifyPassword,
  verifyTurnstile,
} from "../../_lib/security.js";

const CURRENT_PASSWORD_ITERATIONS = 600000;
const USER_COOKIE = "__Host-aogd_session";
const DUMMY_PASSWORD_HASH = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const DUMMY_PASSWORD_SALT = "AAAAAAAAAAAAAAAAAAAAAA==";
const ACCOUNT_ACTIONS = new Set([
  "register",
  "resend-code",
  "verify",
  "login",
  "logout",
  "change-password",
  "delete-account",
  "forgot-password",
  "reset-password",
]);
const TURNSTILE_ACTIONS = new Map([
  ["register", "account_register"],
  ["login", "account_login"],
  ["forgot-password", "account_forgot"],
]);

async function enforceAccountRateLimit(env, request, scope, limit, windowSeconds) {
  await enforceRateLimit(env, request, scope, limit, windowSeconds);
  await cleanupExpired(env);
}

function route(params) {
  const value = Array.isArray(params.path) ? params.path.join("/") : params.path;
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

async function publicUser(db, row) {
  if (!row) return null;
  const [number, roleRows, presence] = await Promise.all([
    db.prepare("SELECT id FROM account_numbers WHERE user_id = ?").bind(row.id).first(),
    db.prepare(`
      SELECT sr.slug, sr.name, sr.color, sr.priority
      FROM staff_assignments sa
      JOIN staff_roles sr ON sr.slug = sa.role_slug
      WHERE sa.user_id = ?
      ORDER BY sr.priority ASC, sr.name ASC
    `).bind(row.id).all(),
    db.prepare("SELECT visible FROM staff_presence WHERE user_id = ?").bind(row.id).first(),
  ]);
  return {
    id: row.id,
    publicId: Number(number?.id || 0),
    email: row.email,
    nickname: row.nickname,
    verified: Boolean(row.verified_at),
    createdAt: row.created_at,
    presenceVisible: presence ? Boolean(Number(presence.visible)) : false,
    roles: (roleRows.results || []).map((role) => ({
      slug: role.slug,
      name: role.name,
      color: role.color,
      priority: Number(role.priority),
    })),
  };
}

function validatePassword(value) {
  const password = String(value || "");
  if (password.length < 15 || password.length > 128) {
    throw new ApiError("Пароль должен содержать от 15 до 128 символов.", 400, "weak_password");
  }
  const common = ["password", "qwerty", "123456", "admin", "пароль"];
  if (common.some((word) => password.toLowerCase().includes(word))) {
    throw new ApiError("Выберите менее предсказуемую парольную фразу.", 400, "weak_password");
  }
  return password;
}

function codeSecret(env) {
  return env.CODE_PEPPER || env.SESSION_SECRET || env.ADMIN_TOKEN;
}

async function codeHash(env, userId, purpose, code) {
  return hmacSha256(codeSecret(env), `${userId}:${purpose}:${code}`);
}

export async function storeEmailCode(env, userId, purpose) {
  const db = requireDatabase(env);
  const code = randomCode();
  const now = new Date();
  const nowIso = now.toISOString();
  const cooldownCutoff = new Date(now.getTime() - 60 * 1000).toISOString();
  const expires = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  const id = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(`
      INSERT INTO email_codes (id, user_id, purpose, code_hash, expires_at, created_at)
      SELECT ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM email_codes
        WHERE user_id = ? AND purpose = ? AND created_at > ?
      )
    `).bind(
      id,
      userId,
      purpose,
      await codeHash(env, userId, purpose, code),
      expires,
      nowIso,
      userId,
      purpose,
      cooldownCutoff,
    ),
    db.prepare(`
      UPDATE email_codes
      SET used_at = ?
      WHERE user_id = ? AND purpose = ? AND used_at IS NULL AND id <> ?
        AND EXISTS (SELECT 1 FROM email_codes WHERE id = ?)
    `).bind(nowIso, userId, purpose, id, id),
  ]);
  if (!results[0]?.meta?.changes) {
    throw new ApiError("Повторный код можно запросить через минуту.", 429, "code_cooldown");
  }
  return code;
}

async function verifyEmailCode(env, user, purpose, code) {
  const db = requireDatabase(env);
  const entry = await db.prepare(`
    SELECT * FROM email_codes
    WHERE user_id = ? AND purpose = ? AND used_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `).bind(user.id, purpose).first();
  const generic = new ApiError("Неверный или истёкший код.", 400, "invalid_code");
  if (!entry || entry.expires_at <= new Date().toISOString() || entry.attempts >= 6) throw generic;
  const candidate = await codeHash(env, user.id, purpose, String(code || "").trim());
  if (!timingSafeEqual(candidate, entry.code_hash)) {
    const failed = await db.prepare(`
      UPDATE email_codes
      SET attempts = attempts + 1
      WHERE id = ? AND used_at IS NULL AND attempts < 6
    `).bind(entry.id).run();
    if (!failed.meta?.changes) throw generic;
    throw generic;
  }
  const consumed = await db.prepare(`
    UPDATE email_codes
    SET used_at = ?
    WHERE id = ? AND used_at IS NULL AND attempts < 6 AND expires_at > ?
  `).bind(new Date().toISOString(), entry.id, new Date().toISOString()).run();
  if (!consumed.meta?.changes) throw generic;
}

async function createSession(db, userId, credentials, beforeStatements = []) {
  const token = randomToken(32);
  const sessionId = crypto.randomUUID();
  const tokenHash = await sha256(token);
  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const insert = db.prepare(`
    INSERT INTO user_sessions (id, user_id, token_hash, expires_at, created_at)
    SELECT ?, id, ?, ?, ?
    FROM users
    WHERE id = ? AND disabled_at IS NULL
      AND password_hash = ? AND password_salt = ? AND password_iterations = ?
  `).bind(
    sessionId,
    tokenHash,
    expires,
    now.toISOString(),
    userId,
    credentials.password_hash,
    credentials.password_salt,
    credentials.password_iterations,
  );
  const trim = db.prepare(`
    DELETE FROM user_sessions
    WHERE user_id = ? AND id <> ?
      AND EXISTS (SELECT 1 FROM user_sessions WHERE id = ?)
      AND id NOT IN (
        SELECT id FROM user_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 5
      )
  `).bind(userId, sessionId, sessionId, userId);
  const results = await db.batch([...beforeStatements, insert, trim]);
  const inserted = results[beforeStatements.length];
  if (!inserted?.meta?.changes) {
    throw new ApiError("Данные аккаунта изменились. Повторите вход.", 409, "account_changed");
  }
  return token;
}

export async function onRequestGet({ request, env, params }) {
  try {
    requireDatabase(env);
    if (route(params) !== "me") throw new ApiError("Маршрут не найден.", 404, "not_found");
    const user = await getCurrentUser(request, env);
    return json({ user: await publicUser(env.DB, user) });
  } catch (error) {
    return safeError(error, request);
  }
}

export async function onRequestPost({ request, env, params }) {
  try {
    assertSameOrigin(request);
    const db = requireDatabase(env);
    const action = route(params);
    if (!ACCOUNT_ACTIONS.has(action)) {
      throw new ApiError("Маршрут не найден.", 404, "not_found");
    }

    const turnstileAction = TURNSTILE_ACTIONS.get(action);
    if (turnstileAction) {
      await enforceRateLimit(env, request, `turnstile-${turnstileAction}`, 30, 60);
    }
    const body = action === "logout" ? {} : await readJson(request);
    if (turnstileAction) {
      await verifyTurnstile(env, request, body.turnstileToken, turnstileAction);
    }

    if (action === "register") {
      const email = normalizeEmail(body.email);
      const nickname = normalizeNickname(body.nickname);
      const password = validatePassword(body.password);
      if (!isValidEmail(email)) throw new ApiError("Укажите корректный адрес электронной почты.", 400, "invalid_email");
      if (!isValidNickname(nickname)) throw new ApiError("Никнейм: 3–32 символа, только буквы, цифры, точка, дефис или подчёркивание.", 400, "invalid_nickname");
      await enforceAccountRateLimit(env, request, "account-register", 4, 3600);
      await enforceSubjectRateLimit(env, "register-email", email, 5, 24 * 60 * 60);
      const existing = await db.prepare("SELECT id FROM users WHERE email = ? OR nickname = ? COLLATE NOCASE").bind(email, nickname).first();
      if (existing) throw new ApiError("Не удалось создать аккаунт с этими данными.", 409, "account_conflict");
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const credentials = await hashPassword(password, undefined, CURRENT_PASSWORD_ITERATIONS);
      await db.prepare(`
        INSERT INTO users (id, email, nickname, password_hash, password_salt, password_iterations, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, email, nickname, credentials.hash, credentials.salt, credentials.iterations, now, now).run();
      try {
        const code = await storeEmailCode(env, id, "verify");
        await sendEmail(env, {
          to: email,
          subject: "Код подтверждения A.O.G.D",
          text: `Ваш код подтверждения: ${code}\n\nКод действует 15 минут. Никому его не сообщайте. Если вы не регистрировались, проигнорируйте письмо.`,
        });
      } catch (error) {
        await db.prepare("DELETE FROM users WHERE id = ? AND verified_at IS NULL").bind(id).run();
        throw error;
      }
      return json({ ok: true, email }, 201);
    }

    if (action === "resend-code") {
      await enforceAccountRateLimit(env, request, "account-resend", 3, 900);
      const email = normalizeEmail(body.email);
      if (!isValidEmail(email)) return json({ ok: true });
      await enforceSubjectRateLimit(env, "resend-email", email, 5, 60 * 60);
      const user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
      if (!user || user.verified_at) return json({ ok: true });
      const code = await storeEmailCode(env, user.id, "verify");
      await sendEmail(env, { to: email, subject: "Новый код подтверждения A.O.G.D", text: `Ваш код: ${code}\n\nКод действует 15 минут. Никому его не сообщайте.` });
      return json({ ok: true });
    }

    if (action === "verify") {
      await enforceAccountRateLimit(env, request, "account-verify", 12, 900);
      const email = normalizeEmail(body.email);
      if (!isValidEmail(email)) throw new ApiError("Неверный или истёкший код.", 400, "invalid_code");
      await enforceSubjectRateLimit(env, "verify-email", email, 20, 60 * 60);
      const user = await db.prepare("SELECT * FROM users WHERE email = ? AND disabled_at IS NULL").bind(email).first();
      if (!user) throw new ApiError("Неверный или истёкший код.", 400, "invalid_code");
      if (user.verified_at) throw new ApiError("Неверный или истёкший код.", 400, "invalid_code");
      await verifyEmailCode(env, user, "verify", body.code);
      const now = new Date().toISOString();
      const verified = await db.prepare(`
        UPDATE users
        SET verified_at = ?, updated_at = ?
        WHERE id = ? AND verified_at IS NULL
      `).bind(now, now, user.id).run();
      if (!verified.meta?.changes) throw new ApiError("Неверный или истёкший код.", 400, "invalid_code");
      user.verified_at = now;
      const token = await createSession(db, user.id, user);
      return json({ user: await publicUser(db, user) }, 200, { "Set-Cookie": sessionCookie(token) });
    }

    if (action === "login") {
      await enforceAccountRateLimit(env, request, "account-login", 10, 900);
      const email = normalizeEmail(body.email);
      const validEmail = isValidEmail(email);
      if (validEmail) await enforceSubjectRateLimit(env, "login-email", email, 30, 60 * 60);
      const user = validEmail
        ? await db.prepare("SELECT * FROM users WHERE email = ? AND disabled_at IS NULL").bind(email).first()
        : null;
      const password = String(body.password || "");
      const valid = user
        ? await verifyPassword(password, user.password_hash, user.password_salt, user.password_iterations)
        : await verifyPassword(password, DUMMY_PASSWORD_HASH, DUMMY_PASSWORD_SALT, CURRENT_PASSWORD_ITERATIONS);
      if (!valid) throw new ApiError("Неверная почта или пароль.", 401, "invalid_credentials");
      if (!user.verified_at) throw new ApiError("Сначала подтвердите почту кодом из письма.", 403, "email_not_verified");
      let credentials = {
        password_hash: user.password_hash,
        password_salt: user.password_salt,
        password_iterations: user.password_iterations,
      };
      const beforeStatements = [];
      if (Number(user.password_iterations || 210000) < CURRENT_PASSWORD_ITERATIONS) {
        const upgraded = await hashPassword(String(body.password), undefined, CURRENT_PASSWORD_ITERATIONS);
        beforeStatements.push(db.prepare(`
          UPDATE users
          SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ?
          WHERE id = ? AND password_hash = ? AND password_salt = ? AND password_iterations = ?
        `).bind(
          upgraded.hash,
          upgraded.salt,
          upgraded.iterations,
          new Date().toISOString(),
          user.id,
          user.password_hash,
          user.password_salt,
          user.password_iterations,
        ));
        credentials = {
          password_hash: upgraded.hash,
          password_salt: upgraded.salt,
          password_iterations: upgraded.iterations,
        };
      }
      const token = await createSession(db, user.id, credentials, beforeStatements);
      return json({ user: await publicUser(db, user) }, 200, { "Set-Cookie": sessionCookie(token) });
    }

    if (action === "logout") {
      const cookies = parseCookies(request);
      const token = cookies[USER_COOKIE];
      if (token) await db.prepare("DELETE FROM user_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
      return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
    }

    if (action === "change-password") {
      const currentUser = await getCurrentUser(request, env);
      if (!currentUser) throw new ApiError("Войдите в аккаунт.", 401, "authentication_required");
      await enforceAccountRateLimit(env, request, "account-change-password", 5, 60 * 60);
      await enforceSubjectRateLimit(env, "change-password-user", currentUser.id, 10, 24 * 60 * 60);
      const user = await db.prepare("SELECT * FROM users WHERE id = ? AND disabled_at IS NULL").bind(currentUser.id).first();
      const valid = user && await verifyPassword(
        String(body.currentPassword || ""),
        user.password_hash,
        user.password_salt,
        user.password_iterations,
      );
      if (!valid) throw new ApiError("Текущий пароль указан неверно.", 401, "invalid_credentials");
      const nextPassword = validatePassword(body.newPassword);
      if (timingSafeEqual(String(body.currentPassword || ""), nextPassword)) {
        throw new ApiError("Новый пароль должен отличаться от текущего.", 400, "password_unchanged");
      }
      const credentials = await hashPassword(nextPassword, undefined, CURRENT_PASSWORD_ITERATIONS);
      const token = parseCookies(request)[USER_COOKIE];
      const tokenHash = token ? await sha256(token) : "";
      const passwordChange = await db.batch([
        db.prepare(`
          UPDATE users
          SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ?
          WHERE id = ? AND password_hash = ? AND password_salt = ? AND password_iterations = ?
        `).bind(
          credentials.hash,
          credentials.salt,
          credentials.iterations,
          new Date().toISOString(),
          user.id,
          user.password_hash,
          user.password_salt,
          user.password_iterations,
        ),
        db.prepare(`
          DELETE FROM user_sessions
          WHERE user_id = ? AND token_hash <> ?
            AND EXISTS (
              SELECT 1 FROM users
              WHERE id = ? AND password_hash = ? AND password_salt = ? AND password_iterations = ?
            )
        `).bind(
          user.id,
          tokenHash,
          user.id,
          credentials.hash,
          credentials.salt,
          credentials.iterations,
        ),
      ]);
      if (!passwordChange[0]?.meta?.changes) {
        throw new ApiError("Данные аккаунта изменились. Повторите вход.", 409, "account_changed");
      }
      await sendEmail(env, {
        to: user.email,
        subject: "Пароль A.O.G.D изменён",
        text: "Пароль вашего аккаунта был изменён. Все остальные активные сеансы завершены. Если это сделали не вы, немедленно восстановите пароль через подтверждённую почту.",
      }).catch(() => {});
      return json({ ok: true });
    }

    if (action === "delete-account") {
      const currentUser = await getCurrentUser(request, env);
      if (!currentUser) throw new ApiError("Войдите в аккаунт.", 401, "authentication_required");
      await enforceAccountRateLimit(env, request, "account-delete", 3, 24 * 60 * 60);
      const user = await db.prepare("SELECT * FROM users WHERE id = ? AND disabled_at IS NULL").bind(currentUser.id).first();
      const valid = user && await verifyPassword(
        String(body.currentPassword || ""),
        user.password_hash,
        user.password_salt,
        user.password_iterations,
      );
      if (!valid) throw new ApiError("Пароль указан неверно.", 401, "invalid_credentials");
      const ownerAssignment = await db.prepare(
        "SELECT 1 AS present FROM staff_assignments WHERE user_id = ? AND role_slug = 'owner'",
      ).bind(user.id).first();
      if (ownerAssignment) {
        const ownerCount = await db.prepare(
          "SELECT COUNT(*) AS total FROM staff_assignments WHERE role_slug = 'owner'",
        ).first();
        if (Number(ownerCount?.total || 0) <= 1) {
          throw new ApiError("Нельзя удалить аккаунт последнего Owner.", 409, "last_owner");
        }
      }
      const credentialGuard = [user.id, user.password_hash, user.password_salt, user.password_iterations];
      let deletion;
      try {
        deletion = await db.batch([
          db.prepare(`
            DELETE FROM support_requests
            WHERE user_id = ? AND EXISTS (
              SELECT 1 FROM users
              WHERE id = ? AND password_hash = ? AND password_salt = ? AND password_iterations = ?
            )
          `).bind(user.id, ...credentialGuard),
          db.prepare(`
            DELETE FROM reception_interests
            WHERE user_id = ? AND EXISTS (
              SELECT 1 FROM users
              WHERE id = ? AND password_hash = ? AND password_salt = ? AND password_iterations = ?
            )
          `).bind(user.id, ...credentialGuard),
          db.prepare(`
            DELETE FROM reception_threads
            WHERE user_id = ? AND EXISTS (
              SELECT 1 FROM users
              WHERE id = ? AND password_hash = ? AND password_salt = ? AND password_iterations = ?
            )
          `).bind(user.id, ...credentialGuard),
          db.prepare(`
            DELETE FROM users
            WHERE id = ? AND password_hash = ? AND password_salt = ? AND password_iterations = ?
          `).bind(...credentialGuard),
        ]);
      } catch (error) {
        if (String(error?.message || "").includes("last_owner")) {
          throw new ApiError("Нельзя удалить аккаунт последнего Owner.", 409, "last_owner");
        }
        throw error;
      }
      if (!deletion[deletion.length - 1]?.meta?.changes) {
        throw new ApiError("Данные аккаунта изменились. Повторите вход.", 409, "account_changed");
      }
      return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
    }

    if (action === "forgot-password") {
      await enforceAccountRateLimit(env, request, "account-forgot", 3, 900);
      const email = normalizeEmail(body.email);
      if (!isValidEmail(email)) {
        return json({ ok: true, message: "Если аккаунт существует, код отправлен на почту." });
      }
      await enforceSubjectRateLimit(env, "forgot-email", email, 5, 24 * 60 * 60);
      const user = await db.prepare("SELECT * FROM users WHERE email = ? AND verified_at IS NOT NULL AND disabled_at IS NULL").bind(email).first();
      if (user) {
        const code = await storeEmailCode(env, user.id, "reset");
        await sendEmail(env, { to: email, subject: "Восстановление пароля A.O.G.D", text: `Код для смены пароля: ${code}\n\nКод действует 15 минут. Никому его не сообщайте. Если вы не запрашивали восстановление, проигнорируйте письмо.` });
      }
      return json({ ok: true, message: "Если аккаунт существует, код отправлен на почту." });
    }

    if (action === "reset-password") {
      await enforceAccountRateLimit(env, request, "account-reset", 8, 900);
      const email = normalizeEmail(body.email);
      if (!isValidEmail(email)) throw new ApiError("Неверный или истёкший код.", 400, "invalid_code");
      await enforceSubjectRateLimit(env, "reset-email", email, 20, 60 * 60);
      const password = validatePassword(body.password);
      const user = await db.prepare("SELECT * FROM users WHERE email = ? AND verified_at IS NOT NULL AND disabled_at IS NULL").bind(email).first();
      if (!user) throw new ApiError("Неверный или истёкший код.", 400, "invalid_code");
      await verifyEmailCode(env, user, "reset", body.code);
      const credentials = await hashPassword(password, undefined, CURRENT_PASSWORD_ITERATIONS);
      const now = new Date().toISOString();
      await db.batch([
        db.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ? WHERE id = ?")
          .bind(credentials.hash, credentials.salt, credentials.iterations, now, user.id),
        db.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(user.id),
      ]);
      return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
    }

    throw new ApiError("Маршрут не найден.", 404, "not_found");
  } catch (error) {
    return safeError(error, request);
  }
}

export function onRequest({ request }) {
  return json({ error: "Метод не поддерживается.", code: "method_not_allowed", requestId: requestId(request) }, 405, { Allow: "GET, POST" });
}
