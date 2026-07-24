import {
  ApiError,
  assertSameOrigin,
  auditAdmin,
  cleanupExpired,
  configurationStatus,
  enforceRateLimit,
  json,
  parseCookies,
  requireAdmin,
  requireDatabase,
  safeError,
  sha256,
} from "../../_lib/security.js";

const ADMIN_COOKIE = "__Host-aogd_admin";

async function count(db, sql, ...bindings) {
  const statement = db.prepare(sql);
  const row = bindings.length ? await statement.bind(...bindings).first() : await statement.first();
  return Number(row?.total || 0);
}

export async function onRequestGet({ request, env }) {
  try {
    const db = requireDatabase(env);
    await requireAdmin(request, env);
    await enforceRateLimit(env, request, "admin-security-read", 120, 60 * 60);
    await cleanupExpired(env);
    const now = new Date().toISOString();
    const [
      activeAdminSessions,
      activeUserSessions,
      pendingSupport,
      pendingReception,
      disabledUsers,
      limitedClients,
      audit,
    ] = await Promise.all([
      count(db, "SELECT COUNT(*) AS total FROM admin_sessions WHERE expires_at > ?", now),
      count(db, "SELECT COUNT(*) AS total FROM user_sessions WHERE expires_at > ?", now),
      count(db, "SELECT COUNT(*) AS total FROM support_requests WHERE status = 'pending'"),
      count(db, "SELECT COUNT(*) AS total FROM reception_threads WHERE status IN ('pending', 'needs_info')"),
      count(db, "SELECT COUNT(*) AS total FROM users WHERE disabled_at IS NOT NULL"),
      count(db, "SELECT COUNT(*) AS total FROM rate_limits WHERE reset_at > ? AND count > 1", now),
      db.prepare(`
        SELECT action, target_id, details, request_id, created_at
        FROM admin_audit_log
        ORDER BY created_at DESC
        LIMIT 80
      `).all(),
    ]);
    return json({
      summary: { activeAdminSessions, activeUserSessions, pendingSupport, pendingReception, disabledUsers, limitedClients },
      configuration: configurationStatus(env),
      audit: audit.results.map((row) => ({
        action: row.action,
        targetId: row.target_id || "",
        details: row.details || "",
        requestId: row.request_id || "",
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    return safeError(error, request, "Не удалось загрузить центр безопасности.");
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    assertSameOrigin(request);
    const db = requireDatabase(env);
    await requireAdmin(request, env);
    const token = parseCookies(request)[ADMIN_COOKIE];
    if (!token) throw new ApiError("Требуется вход администратора.", 401, "admin_auth_required");
    const currentHash = await sha256(token);
    await db.prepare("DELETE FROM admin_sessions WHERE token_hash <> ?").bind(currentHash).run();
    await auditAdmin(env, request, "admin.sessions.revoke_others");
    return json({ ok: true });
  } catch (error) {
    return safeError(error, request, "Не удалось завершить другие сеансы.");
  }
}

export function onRequest({ request }) {
  return json(
    { error: "Метод не поддерживается.", code: "method_not_allowed" },
    405,
    { Allow: "GET, DELETE" },
  );
}
