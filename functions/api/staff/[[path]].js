import {
  ApiError,
  assertAllowedSearchParams,
  assertSameOrigin,
  prepareAdminAudit,
  cleanText,
  enforceRateLimit,
  enforceSubjectRateLimit,
  getCurrentUser,
  json,
  readJson,
  requestId,
  accessHasPermission,
  requirePermission,
  requireDatabase,
  safeError,
  STAFF_PERMISSIONS,
} from "../../_lib/security.js";

const ONLINE_WINDOW_MS = 3 * 60 * 1000;
const ROLE_COLOR = /^#[0-9a-f]{6}$/i;

function route(params) {
  const value = Array.isArray(params.path) ? params.path.join("/") : params.path;
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function publicRole(row) {
  return {
    slug: row.slug,
    name: row.name,
    color: row.color,
    priority: Number(row.priority),
    system: Boolean(row.is_system),
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
  };
}

function normalizedPermissions(value) {
  const permissions = [...new Set(Array.isArray(value) ? value.map(String) : [])];
  if (permissions.length > STAFF_PERMISSIONS.length || permissions.some((item) => !STAFF_PERMISSIONS.includes(item))) {
    throw new ApiError("Список разрешений содержит неизвестное действие.", 400, "invalid_permissions");
  }
  return permissions;
}

async function rolesForUsers(db, userIds) {
  if (!userIds.length) return new Map();
  const placeholders = userIds.map(() => "?").join(",");
  const rows = await db.prepare(`
    SELECT sa.user_id, sr.slug, sr.name, sr.color, sr.priority, sr.is_system
    FROM staff_assignments sa
    JOIN staff_roles sr ON sr.slug = sa.role_slug
    WHERE sa.user_id IN (${placeholders})
    ORDER BY sr.priority ASC, sr.name ASC
  `).bind(...userIds).all();
  const grouped = new Map(userIds.map((id) => [id, []]));
  for (const row of rows.results || []) grouped.get(row.user_id)?.push(publicRole(row));
  return grouped;
}

function presenceState(row, now = Date.now()) {
  if (!Number(row.presence_visible ?? 0)) return "hidden";
  if (!row.last_seen_at) return "offline";
  return now - new Date(row.last_seen_at).getTime() <= ONLINE_WINDOW_MS ? "online" : "offline";
}

async function listPublicStaff(db) {
  const result = await db.prepare(`
    SELECT
      u.id,
      u.nickname,
      an.id AS public_id,
      sp.last_seen_at,
      COALESCE(sp.visible, 0) AS presence_visible,
      MIN(sr.priority) AS top_priority
    FROM users u
    JOIN account_numbers an ON an.user_id = u.id
    JOIN staff_assignments sa ON sa.user_id = u.id
    JOIN staff_roles sr ON sr.slug = sa.role_slug
    LEFT JOIN staff_presence sp ON sp.user_id = u.id
    WHERE u.verified_at IS NOT NULL AND u.disabled_at IS NULL
    GROUP BY u.id, u.nickname, an.id, sp.last_seen_at, sp.visible
    ORDER BY top_priority ASC, u.nickname COLLATE NOCASE ASC
    LIMIT 100
  `).all();
  const rows = result.results || [];
  const roles = await rolesForUsers(db, rows.map((row) => row.id));
  const now = Date.now();
  return rows.map((row) => ({
    publicId: Number(row.public_id),
    nickname: row.nickname,
    presence: presenceState(row, now),
    roles: roles.get(row.id) || [],
  }));
}

async function listAdminPeople(db, query) {
  const search = `%${query.toLowerCase()}%`;
  const result = await db.prepare(`
    SELECT
      u.id,
      u.email,
      u.nickname,
      u.verified_at,
      u.disabled_at,
      u.created_at,
      an.id AS public_id,
      sp.last_seen_at,
      COALESCE(sp.visible, 1) AS presence_visible
    FROM users u
    JOIN account_numbers an ON an.user_id = u.id
    LEFT JOIN staff_presence sp ON sp.user_id = u.id
    WHERE (? = '%%'
      OR LOWER(u.nickname) LIKE ?
      OR LOWER(u.email) LIKE ?
      OR CAST(an.id AS TEXT) LIKE ?)
    ORDER BY an.id DESC
    LIMIT 100
  `).bind(search, search, search, search).all();
  const rows = result.results || [];
  const roles = await rolesForUsers(db, rows.map((row) => row.id));
  const now = Date.now();
  return rows.map((row) => ({
    id: row.id,
    publicId: Number(row.public_id),
    email: row.email,
    nickname: row.nickname,
    verified: Boolean(row.verified_at),
    disabled: Boolean(row.disabled_at),
    createdAt: row.created_at,
    presence: presenceState(row, now),
    presenceVisible: Boolean(Number(row.presence_visible)),
    roles: roles.get(row.id) || [],
  }));
}

async function allRoles(db) {
  const result = await db.prepare(`
    SELECT sr.slug, sr.name, sr.color, sr.priority, sr.is_system, srp.permission
    FROM staff_roles sr
    LEFT JOIN staff_role_permissions srp ON srp.role_slug = sr.slug
    ORDER BY sr.priority ASC, sr.name ASC, srp.permission ASC
  `).all();
  const grouped = new Map();
  for (const row of result.results || []) {
    if (!grouped.has(row.slug)) grouped.set(row.slug, publicRole({ ...row, permissions: [] }));
    if (row.permission) grouped.get(row.slug).permissions.push(row.permission);
  }
  return [...grouped.values()];
}

export async function onRequestGet({ request, env, params }) {
  try {
    const action = route(params);
    if (action === "public") {
      assertAllowedSearchParams(request);
      const db = requireDatabase(env);
      return json(
        { staff: await listPublicStaff(db) },
        200,
        { "Cache-Control": "public, max-age=30, must-revalidate" },
      );
    }
    if (action === "admin") {
      assertAllowedSearchParams(request, ["q"]);
      const db = requireDatabase(env);
      const access = await requirePermission(request, env, "staff.read");
      await enforceRateLimit(env, request, "admin-staff-read", 120, 60);
      const query = cleanText(new URL(request.url).searchParams.get("q") || "", 64);
      const [people, roles] = await Promise.all([listAdminPeople(db, query), allRoles(db)]);
      return json({ people, roles, access, permissionCatalog: STAFF_PERMISSIONS });
    }
    throw new ApiError("Маршрут не найден.", 404, "not_found");
  } catch (error) {
    return safeError(error, request);
  }
}

export async function onRequestPost({ request, env, params }) {
  try {
    assertSameOrigin(request);
    const db = requireDatabase(env);
    const action = route(params);
    if (action === "heartbeat") {
      const user = await getCurrentUser(request, env);
      if (!user?.verified_at) throw new ApiError("Войдите в подтверждённый аккаунт.", 401, "authentication_required");
      await enforceSubjectRateLimit(env, "staff-heartbeat", user.id, 8, 5 * 60);
      const assignment = await db.prepare("SELECT 1 AS present FROM staff_assignments WHERE user_id = ? LIMIT 1")
        .bind(user.id).first();
      if (!assignment) throw new ApiError("Статус присутствия доступен сотрудникам.", 403, "staff_required");
      const now = new Date().toISOString();
      await db.prepare(`
        INSERT INTO staff_presence (user_id, last_seen_at, visible, updated_at)
        VALUES (?, ?, 0, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          last_seen_at = excluded.last_seen_at,
          updated_at = excluded.updated_at
      `).bind(user.id, now, now).run();
      return json({ ok: true });
    }
    if (action === "admin/roles") {
      await requirePermission(request, env, "staff.manage_roles");
      await enforceRateLimit(env, request, "admin-role-create", 15, 60 * 60);
      const body = await readJson(request, 8 * 1024);
      const name = cleanText(body.name, 28, 2);
      const color = String(body.color || "").toLowerCase();
      if (!ROLE_COLOR.test(color)) throw new ApiError("Укажите цвет в формате #RRGGBB.", 400, "invalid_role_color");
      const priority = Math.max(25, Math.min(150, Number.parseInt(body.priority, 10) || 80));
      const permissions = normalizedPermissions(body.permissions);
      if (permissions.length) await requirePermission(request, env, "staff.manage_permissions");
      const slug = `custom-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const create = db.prepare(`
        INSERT INTO staff_roles (slug, name, color, priority, is_system, created_at)
        VALUES (?, ?, ?, ?, 0, ?)
      `).bind(slug, name, color, priority, new Date().toISOString());
      const statements = [create];
      const now = new Date().toISOString();
      for (const permission of permissions) {
        statements.push(db.prepare(`
          INSERT INTO staff_role_permissions (role_slug, permission, created_at) VALUES (?, ?, ?)
        `).bind(slug, permission, now));
      }
      statements.push(await prepareAdminAudit(env, request, "staff.role.create", slug, { name, color, priority, permissions }));
      await db.batch(statements);
      return json({ role: { slug, name, color, priority, system: false, permissions } }, 201);
    }
    throw new ApiError("Маршрут не найден.", 404, "not_found");
  } catch (error) {
    return safeError(error, request);
  }
}

export async function onRequestPut({ request, env, params }) {
  try {
    assertSameOrigin(request);
    const db = requireDatabase(env);
    const action = route(params);
    if (action === "preference") {
      const user = await getCurrentUser(request, env);
      if (!user?.verified_at) throw new ApiError("Войдите в подтверждённый аккаунт.", 401, "authentication_required");
      await enforceSubjectRateLimit(env, "staff-presence-preference", user.id, 10, 60 * 60);
      const assignment = await db.prepare("SELECT 1 AS present FROM staff_assignments WHERE user_id = ? LIMIT 1")
        .bind(user.id).first();
      if (!assignment) throw new ApiError("Настройка доступна сотрудникам.", 403, "staff_required");
      const body = await readJson(request, 4 * 1024);
      if (typeof body.visible !== "boolean") throw new ApiError("Некорректное значение видимости.", 400, "invalid_visibility");
      const now = new Date().toISOString();
      await db.prepare(`
        INSERT INTO staff_presence (user_id, last_seen_at, visible, updated_at)
        VALUES (?, NULL, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET visible = excluded.visible, updated_at = excluded.updated_at
      `).bind(user.id, body.visible ? 1 : 0, now).run();
      return json({ ok: true, visible: body.visible });
    }
    const roleMatch = /^admin\/roles\/([^/]+)$/.exec(action);
    if (roleMatch) {
      await requirePermission(request, env, "staff.manage_permissions");
      await enforceRateLimit(env, request, "admin-role-update", 40, 60 * 60);
      const slug = decodeURIComponent(roleMatch[1]);
      if (slug === "owner") throw new ApiError("Права Owner всегда полные и не изменяются.", 409, "owner_permissions_immutable");
      const role = await db.prepare("SELECT slug FROM staff_roles WHERE slug = ?").bind(slug).first();
      if (!role) throw new ApiError("Должность не найдена.", 404, "role_not_found");
      const body = await readJson(request, 12 * 1024);
      const permissions = normalizedPermissions(body.permissions);
      const name = cleanText(body.name, 28, 2);
      const color = String(body.color || "").toLowerCase();
      if (!ROLE_COLOR.test(color)) throw new ApiError("Укажите цвет в формате #RRGGBB.", 400, "invalid_role_color");
      const priority = Math.max(15, Math.min(150, Number.parseInt(body.priority, 10) || 80));
      const now = new Date().toISOString();
      const statements = [
        db.prepare("UPDATE staff_roles SET name = ?, color = ?, priority = ? WHERE slug = ?")
          .bind(name, color, priority, slug),
        db.prepare("DELETE FROM staff_role_permissions WHERE role_slug = ?").bind(slug),
      ];
      for (const permission of permissions) {
        statements.push(db.prepare(`
          INSERT INTO staff_role_permissions (role_slug, permission, created_at) VALUES (?, ?, ?)
        `).bind(slug, permission, now));
      }
      statements.push(await prepareAdminAudit(env, request, "staff.role.permissions.update", slug, {
        name, color, priority, permissions,
      }));
      await db.batch(statements);
      return json({ role: { slug, name, color, priority, permissions } });
    }
    const match = /^admin\/users\/([^/]+)\/roles$/.exec(action);
    if (match) {
      const access = await requirePermission(request, env, "staff.assign_roles");
      await enforceRateLimit(env, request, "admin-role-assign", 60, 60 * 60);
      const userId = decodeURIComponent(match[1]);
      const body = await readJson(request, 8 * 1024);
      const requested = [...new Set(Array.isArray(body.roles) ? body.roles.map(String) : [])];
      if (requested.length > 8 || requested.some((slug) => !/^[a-z0-9-]{2,48}$/.test(slug))) {
        throw new ApiError("Некорректный список должностей.", 400, "invalid_roles");
      }
      const user = await db.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
      if (!user) throw new ApiError("Пользователь не найден.", 404, "user_not_found");
      const existingRoles = await db.prepare("SELECT role_slug FROM staff_assignments WHERE user_id = ?")
        .bind(userId).all();
      const previouslyOwner = (existingRoles.results || []).some((row) => row.role_slug === "owner");
      if ((requested.includes("owner") || previouslyOwner) && !accessHasPermission(access, "staff.manage_permissions")) {
        throw new ApiError("Назначать или снимать Owner может только владелец.", 403, "owner_assignment_forbidden");
      }
      if (requested.length) {
        const placeholders = requested.map(() => "?").join(",");
        const valid = await db.prepare(`SELECT slug FROM staff_roles WHERE slug IN (${placeholders})`)
          .bind(...requested).all();
        if ((valid.results || []).length !== requested.length) throw new ApiError("Одна из должностей не существует.", 400, "unknown_role");
      }
      if (previouslyOwner && !requested.includes("owner")) {
        const ownerCount = await db.prepare("SELECT COUNT(*) AS total FROM staff_assignments WHERE role_slug = 'owner'").first();
        if (Number(ownerCount?.total || 0) <= 1) {
          throw new ApiError("Нельзя снять должность с последнего Owner.", 409, "last_owner");
        }
      }
      const now = new Date().toISOString();
      const statements = [];
      if (requested.length) {
        const placeholders = requested.map(() => "?").join(",");
        statements.push(
          db.prepare(`DELETE FROM staff_assignments WHERE user_id = ? AND role_slug NOT IN (${placeholders})`)
            .bind(userId, ...requested),
        );
      } else {
        statements.push(db.prepare("DELETE FROM staff_assignments WHERE user_id = ?").bind(userId));
      }
      for (const slug of requested) {
        statements.push(db.prepare(`
          INSERT OR IGNORE INTO staff_assignments (user_id, role_slug, assigned_at, assigned_by)
          VALUES (?, ?, ?, ?)
        `).bind(userId, slug, now, access.userId || "owner-session"));
      }
      statements.push(await prepareAdminAudit(env, request, "staff.roles.update", userId, { roles: requested }));
      try {
        await db.batch(statements);
      } catch (error) {
        if (String(error?.message || "").includes("last_owner")) {
          throw new ApiError("Нельзя снять должность с последнего Owner.", 409, "last_owner");
        }
        throw error;
      }
      return json({ ok: true, roles: requested });
    }
    throw new ApiError("Маршрут не найден.", 404, "not_found");
  } catch (error) {
    return safeError(error, request);
  }
}

export async function onRequestDelete({ request, env, params }) {
  try {
    assertSameOrigin(request);
    const db = requireDatabase(env);
    const match = /^admin\/roles\/([^/]+)$/.exec(route(params));
    if (!match) throw new ApiError("Маршрут не найден.", 404, "not_found");
    await requirePermission(request, env, "staff.manage_roles");
    await enforceRateLimit(env, request, "admin-role-delete", 15, 60 * 60);
    const slug = decodeURIComponent(match[1]);
    const role = await db.prepare("SELECT slug, is_system FROM staff_roles WHERE slug = ?").bind(slug).first();
    if (!role) throw new ApiError("Должность не найдена.", 404, "role_not_found");
    if (Number(role.is_system)) throw new ApiError("Системную должность нельзя удалить.", 409, "system_role");
    const remove = db.prepare("DELETE FROM staff_roles WHERE slug = ?").bind(slug);
    const audit = await prepareAdminAudit(env, request, "staff.role.delete", slug);
    await db.batch([remove, audit]);
    return json({ ok: true });
  } catch (error) {
    return safeError(error, request);
  }
}

export function onRequest({ request }) {
  return json(
    { error: "Метод не поддерживается.", code: "method_not_allowed", requestId: requestId(request) },
    405,
    { Allow: "GET, POST, PUT, DELETE" },
  );
}
