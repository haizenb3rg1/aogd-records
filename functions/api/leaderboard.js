import { assertAllowedSearchParams, json, requireDatabase, safeError } from "../_lib/security.js";

export async function onRequestGet({ request, env }) {
  try {
    assertAllowedSearchParams(request);
    const db = requireDatabase(env);
    const result = await db.prepare(`
      SELECT u.nickname, COUNT(s.id) AS approved_count, MAX(s.updated_at) AS last_approved_at
      FROM users u
      JOIN support_requests s ON s.user_id = u.id AND s.status = 'approved'
      WHERE u.verified_at IS NOT NULL AND u.disabled_at IS NULL
      GROUP BY u.id, u.nickname
      HAVING COUNT(s.id) > 0
      ORDER BY approved_count DESC, last_approved_at ASC
      LIMIT 20
    `).all();
    return json({ leaders: result.results.map((row, index) => ({
      rank: index + 1,
      nickname: row.nickname,
      approvedCount: Number(row.approved_count || 0),
    })) }, 200, { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" });
  } catch (error) {
    return safeError(error, request, "Не удалось загрузить рейтинг.");
  }
}

export function onRequest({ request }) {
  return json(
    { error: "Метод не поддерживается.", code: "method_not_allowed" },
    405,
    { Allow: "GET" },
  );
}
