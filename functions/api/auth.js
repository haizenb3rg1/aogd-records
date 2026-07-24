import {
  ApiError,
  adminCookie,
  assertSameOrigin,
  cleanupExpired,
  clearAdminCookie,
  createAdminSession,
  enforceRateLimit,
  isAdmin,
  json,
  parseCookies,
  prepareAdminAudit,
  readJson,
  requireDatabase,
  safeError,
  sha256,
  verifyAdminSecret,
  verifyAdminSecondFactor,
  verifyTurnstile,
} from "../_lib/security.js";

const ADMIN_COOKIE = "__Host-aogd_admin";

export async function onRequestGet({ request, env }) {
  try {
    requireDatabase(env);
    return json({ authenticated: await isAdmin(request, env) });
  } catch (error) {
    return safeError(error, request);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    assertSameOrigin(request);
    requireDatabase(env);
    await enforceRateLimit(env, request, "turnstile-admin-login", 30, 60);
    const body = await readJson(request, 8 * 1024);
    await verifyTurnstile(env, request, body.turnstileToken, "admin_login");
    await enforceRateLimit(env, request, "admin-login", 8, 15 * 60);
    const [passwordValid, secondFactorValid] = await Promise.all([
      verifyAdminSecret(String(body.secret || ""), env),
      verifyAdminSecondFactor(body.otp, env),
    ]);
    if (!passwordValid || !secondFactorValid) {
      throw new ApiError("Неверные данные администратора.", 401, "invalid_admin_credentials");
    }
    await cleanupExpired(env);
    const audit = await prepareAdminAudit(env, request, "admin.login");
    const token = await createAdminSession(env, [audit]);
    return json(
      { authenticated: true },
      200,
      { "Set-Cookie": adminCookie(token) },
    );
  } catch (error) {
    return safeError(error, request, "Не удалось выполнить вход.");
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    assertSameOrigin(request);
    const db = requireDatabase(env);
    const token = parseCookies(request)[ADMIN_COOKIE];
    if (!token || !(await isAdmin(request, env))) {
      return json({ authenticated: false }, 200, { "Set-Cookie": clearAdminCookie() });
    }
    await enforceRateLimit(env, request, "admin-logout", 30, 60 * 60);
    const remove = db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await sha256(token));
    const audit = await prepareAdminAudit(env, request, "admin.logout");
    await db.batch([remove, audit]);
    return json({ authenticated: false }, 200, { "Set-Cookie": clearAdminCookie() });
  } catch (error) {
    return safeError(error, request, "Не удалось завершить сеанс.");
  }
}

export function onRequest({ request }) {
  return json(
    { error: "Метод не поддерживается.", code: "method_not_allowed" },
    405,
    { Allow: "GET, POST, DELETE" },
  );
}
