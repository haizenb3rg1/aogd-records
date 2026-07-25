import {
  ApiError,
  DANGEROUS_PERMISSIONS,
  STAFF_PERMISSIONS,
  accessHasPermission,
  assertAllowedSearchParams,
  assertSameOrigin,
  cleanText,
  enforceRateLimit,
  enforceSubjectRateLimit,
  getAdminAccess,
  getCurrentUser,
  json,
  prepareAdminAudit,
  readJson,
  requestId,
  requireDatabase,
  requirePermission,
  safeError,
} from "../../_lib/security.js";

const ONLINE_WINDOW_MS = 3 * 60 * 1000;
const ROLE_COLOR = /^#[0-9a-f]{6}$/i;
const ROLE_SLUG = /^[a-z0-9-]{2,48}$/;

function route(params) {
  const value = Array.isArray(params.path) ? params.path.join("/") : params.path;
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function publicRole(row) {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description || "",
    color: row.color,
    priority: Number(row.priority),
    system: Boolean(row.is_system),
    editable: Boolean(row.is_editable),
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    updatedAt: row.updated_at || row.created_at,
  };
}

function presenceState(row, now = Date.now()) {
  if (!Number(row.presence_visible ?? 0)) return "hidden";
  if (!row.last_seen_at) return "offline";
  return now - new Date(row.last_seen_at).getTime() <= ONLINE_WINDOW_MS ? "online" : "offline";
}

function normalizedPermissions(value) {
  const permissions = [...new Set(Array.isArray(value) ? value.map(String) : [])].sort();
  if (
    permissions.length > STAFF_PERMISSIONS.length
    || permissions.some((permission) => !STAFF_PERMISSIONS.includes(permission))
  ) {
    throw new ApiError("Список разрешений содержит неизвестное действие.", 400, "invalid_permissions");
  }
  return permissions;
}

function isOwner(access) {
  return Boolean(access?.roles?.includes("owner") && access?.permissions?.includes("*"));
}

function ensurePermissionsGrantable(access, permissions) {
  if (isOwner(access)) return;
  const missing = permissions.filter((permission) => !accessHasPermission(access, permission));
  if (missing.length) {
    throw new ApiError(
      "Нельзя выдать роли разрешения, которых нет у вас.",
      403,
      "permission_escalation_forbidden",
    );
  }
  if (permissions.some((permission) => DANGEROUS_PERMISSIONS.includes(permission))) {
    throw new ApiError(
      "Опасные разрешения может назначать только Owner.",
      403,
      "dangerous_permission_owner_required",
    );
  }
}

async function rolesForUsers(db, userIds) {
  if (!userIds.length) return new Map();
  const placeholders = userIds.map(() => "?").join(",");
  const result = await db.prepare(`
    SELECT sa.user_id, sr.slug, sr.name, sr.description, sr.color, sr.priority,
           sr.is_system, sr.is_editable, sr.updated_at, sr.created_at
    FROM staff_assignments sa
    JOIN staff_roles sr ON sr.slug = sa.role_slug
    WHERE sa.user_id IN (${placeholders})
    ORDER BY sr.priority ASC, sr.name ASC
  `).bind(...userIds).all();
  const grouped = new Map(userIds.map((id) => [id, []]));
  for (const row of result.results || []) grouped.get(row.user_id)?.push(publicRole(row));
  return grouped;
}

async function allRoles(db) {
  const result = await db.prepare(`
    SELECT sr.slug, sr.name, sr.description, sr.color, sr.priority, sr.is_system,
           sr.is_editable, sr.updated_at, sr.created_at, rp.permission_key
    FROM staff_roles sr
    LEFT JOIN role_permissions rp ON rp.role_slug = sr.slug
    ORDER BY sr.priority ASC, sr.name ASC, rp.permission_key ASC
  `).all();
  const grouped = new Map();
  for (const row of result.results || []) {
    if (!grouped.has(row.slug)) grouped.set(row.slug, publicRole({ ...row, permissions: [] }));
    if (row.permission_key) grouped.get(row.slug).permissions.push(row.permission_key);
  }
  return [...grouped.values()];
}

async function permissionCatalog(db) {
  const result = await db.prepare(`
    SELECT key, name_ru, name_en, category, description, is_dangerous
    FROM permissions
    ORDER BY category ASC, key ASC
  `).all();
  return (result.results || []).map((row) => ({
    key: row.key,
    nameRu: row.name_ru,
    nameEn: row.name_en,
    category: row.category,
    description: row.description || "",
    dangerous: Boolean(row.is_dangerous),
  }));
}

async function listPublicStaff(db) {
  const result = await db.prepare(`
    SELECT u.id, u.nickname, an.id AS public_id, sp.last_seen_at,
           COALESCE(sp.visible, 0) AS presence_visible, MIN(sr.priority) AS top_priority
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

async function listAdminPeople(db, query, includeEmail) {
  const search = `%${query.toLowerCase()}%`;
  const result = await db.prepare(`
    SELECT u.id, u.email, u.nickname, u.verified_at, u.disabled_at, u.created_at,
           an.id AS public_id, sp.last_seen_at, COALESCE(sp.visible, 1) AS presence_visible
    FROM users u
    JOIN account_numbers an ON an.user_id = u.id
    LEFT JOIN staff_presence sp ON sp.user_id = u.id
    WHERE (? = '%%'
      OR LOWER(u.nickname) LIKE ?
      OR (? = 1 AND LOWER(u.email) LIKE ?)
      OR CAST(an.id AS TEXT) LIKE ?)
    ORDER BY an.id DESC
    LIMIT 100
  `).bind(search, search, includeEmail ? 1 : 0, search, search).all();
  const rows = result.results || [];
  const roles = await rolesForUsers(db, rows.map((row) => row.id));
  const now = Date.now();
  return rows.map((row) => ({
    id: row.id,
    publicId: Number(row.public_id),
    ...(includeEmail ? { email: row.email } : {}),
    nickname: row.nickname,
    verified: Boolean(row.verified_at),
    disabled: Boolean(row.disabled_at),
    createdAt: row.created_at,
    presence: presenceState(row, now),
    presenceVisible: Boolean(Number(row.presence_visible)),
    roles: roles.get(row.id) || [],
  }));
}

async function rolePermissions(db, slugs) {
  if (!slugs.length) return [];
  const placeholders = slugs.map(() => "?").join(",");
  const result = await db.prepare(`
    SELECT DISTINCT permission_key
    FROM role_permissions
    WHERE role_slug IN (${placeholders})
  `).bind(...slugs).all();
  return (result.results || []).map((row) => row.permission_key);
}

async function assertAssignableRoles(db, access, requested) {
  if (!requested.length) return;
  const placeholders = requested.map(() => "?").join(",");
  const valid = await db.prepare(`SELECT slug FROM staff_roles WHERE slug IN (${placeholders})`)
    .bind(...requested).all();
  if ((valid.results || []).length !== requested.length) {
    throw new ApiError("Одна из должностей не существует.", 400, "unknown_role");
  }
  if (requested.includes("owner") && !isOwner(access)) {
    throw new ApiError("Назначать Owner может только Owner.", 403, "owner_assignment_forbidden");
  }
  if (!isOwner(access)) ensurePermissionsGrantable(access, await rolePermissions(db, requested));
}

export async function onRequestGet({ request, env, params }) {
  try {
    const action = route(params);
    const db = requireDatabase(env);
    if (action === "public") {
      assertAllowedSearchParams(request);
      return json({ staff: await listPublicStaff(db) }, 200, {
        "Cache-Control": "public, max-age=30, must-revalidate",
      });
    }
    if (action === "admin" || action === "admin/roles" || action === "admin/permissions") {
      assertAllowedSearchParams(request, action === "admin" ? ["q"] : []);
      const access = action === "admin"
        ? await getAdminAccess(request, env)
        : await requirePermission(request, env, "roles.view");
      if (!access) throw new ApiError("Требуется вход сотрудника.", 401, "admin_auth_required");
      if (
        action === "admin"
        && !accessHasPermission(access, "users.view")
        && !accessHasPermission(access, "roles.view")
      ) {
        throw new ApiError("У вашей должности нет права на этот раздел.", 403, "permission_denied");
      }
      await enforceRateLimit(env, request, "admin-staff-read", 120, 60);
      if (action === "admin/permissions") return json({ permissions: await permissionCatalog(db) });
      if (action === "admin/roles") return json({ roles: await allRoles(db), access });
      const query = cleanText(new URL(request.url).searchParams.get("q") || "", 64);
      const [people, roles, catalog] = await Promise.all([
        accessHasPermission(access, "users.view")
          ? listAdminPeople(db, query, accessHasPermission(access, "users.view_email"))
          : Promise.resolve([]),
        accessHasPermission(access, "roles.view") ? allRoles(db) : Promise.resolve([]),
        accessHasPermission(access, "roles.view") ? permissionCatalog(db) : Promise.resolve([]),
      ]);
      return json({ people, roles, access, permissionCatalog: catalog });
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
        ON CONFLICT(user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at
      `).bind(user.id, now, now).run();
      return json({ ok: true });
    }
    if (action === "admin/roles") {
      const access = await requirePermission(request, env, "roles.create");
      await enforceRateLimit(env, request, "admin-role-create", 15, 60 * 60);
      const body = await readJson(request, 16 * 1024);
      const name = cleanText(body.name, 36, 2);
      const description = cleanText(body.description, 240);
      const color = String(body.color || "").toLowerCase();
      if (!ROLE_COLOR.test(color)) throw new ApiError("Укажите цвет в формате #RRGGBB.", 400, "invalid_role_color");
      const priority = Math.max(15, Math.min(150, Number.parseInt(body.priority, 10) || 80));
      const permissions = normalizedPermissions(body.permissions);
      ensurePermissionsGrantable(access, permissions);
      if (permissions.length) await requirePermission(request, env, "roles.manage_permissions");
      const slug = `custom-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const now = new Date().toISOString();
      const statements = [
        db.prepare(`
          INSERT INTO staff_roles
            (slug, name, description, color, priority, is_system, is_editable, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)
        `).bind(slug, name, description, color, priority, now, now),
      ];
      for (const permission of permissions) {
        statements.push(db.prepare(`
          INSERT INTO role_permissions (role_slug, permission_key, granted_at, granted_by)
          VALUES (?, ?, ?, ?)
        `).bind(slug, permission, now, access.userId || "owner-session"));
      }
      statements.push(await prepareAdminAudit(env, request, "staff.role.create", slug, {
        name, description, color, priority, permissions,
      }));
      await db.batch(statements);
      return json({ role: publicRole({
        slug, name, description, color, priority, is_system: 0, is_editable: 1,
        permissions, created_at: now, updated_at: now,
      }) }, 201);
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
      if (typeof body.visible !== "boolean") {
        throw new ApiError("Некорректное значение видимости.", 400, "invalid_visibility");
      }
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
      const access = await getAdminAccess(request, env);
      if (!access) throw new ApiError("Требуется вход сотрудника.", 401, "admin_auth_required");
      await enforceRateLimit(env, request, "admin-role-update", 40, 60 * 60);
      const slug = decodeURIComponent(roleMatch[1]);
      const role = await db.prepare(`
        SELECT slug, name, description, color, priority, is_editable
        FROM staff_roles WHERE slug = ?
      `).bind(slug).first();
      if (!role) throw new ApiError("Должность не найдена.", 404, "role_not_found");
      if (slug === "owner" || !Number(role.is_editable)) {
        throw new ApiError("Права Owner всегда полные и не изменяются.", 409, "owner_permissions_immutable");
      }
      if (!isOwner(access) && access.userId) {
        const assignedToSelf = await db.prepare(`
          SELECT 1 AS present FROM staff_assignments WHERE user_id = ? AND role_slug = ?
        `).bind(access.userId, slug).first();
        if (assignedToSelf) {
          throw new ApiError("Нельзя изменять роль, назначенную самому себе.", 403, "self_role_edit_forbidden");
        }
      }
      const body = await readJson(request, 16 * 1024);
      const name = cleanText(body.name, 36, 2);
      const description = cleanText(body.description, 240);
      const color = String(body.color || "").toLowerCase();
      if (!ROLE_COLOR.test(color)) throw new ApiError("Укажите цвет в формате #RRGGBB.", 400, "invalid_role_color");
      const priority = Math.max(15, Math.min(150, Number.parseInt(body.priority, 10) || 80));
      const permissions = normalizedPermissions(body.permissions);
      const previousPermissions = (await rolePermissions(db, [slug])).sort();
      const permissionsChanged = JSON.stringify(previousPermissions) !== JSON.stringify(permissions);
      const metadataChanged = (
        name !== role.name
        || description !== (role.description || "")
        || color !== role.color
        || priority !== Number(role.priority)
      );
      if (metadataChanged) await requirePermission(request, env, "roles.edit");
      if (permissionsChanged) {
        await requirePermission(request, env, "roles.manage_permissions");
        ensurePermissionsGrantable(access, permissions);
      }
      if (!metadataChanged && !permissionsChanged) return json({ role: { slug, name, description, color, priority, permissions } });
      const now = new Date().toISOString();
      const statements = [
        db.prepare(`
          UPDATE staff_roles
          SET name = ?, description = ?, color = ?, priority = ?, updated_at = ?
          WHERE slug = ?
        `).bind(name, description, color, priority, now, slug),
      ];
      if (permissionsChanged) {
        statements.push(db.prepare("DELETE FROM role_permissions WHERE role_slug = ?").bind(slug));
        for (const permission of permissions) {
          statements.push(db.prepare(`
            INSERT INTO role_permissions (role_slug, permission_key, granted_at, granted_by)
            VALUES (?, ?, ?, ?)
          `).bind(slug, permission, now, access.userId || "owner-session"));
        }
      }
      statements.push(await prepareAdminAudit(env, request, "staff.role.permissions.update", slug, {
        name, description, color, priority, permissions,
      }));
      await db.batch(statements);
      return json({ role: { slug, name, description, color, priority, permissions } });
    }

    const rolesMatch = /^admin\/users\/([^/]+)\/roles$/.exec(action);
    if (rolesMatch) {
      const access = await requirePermission(request, env, "roles.assign");
      await requirePermission(request, env, "users.assign_roles");
      await enforceRateLimit(env, request, "admin-role-assign", 60, 60 * 60);
      const userId = decodeURIComponent(rolesMatch[1]);
      if (access.userId && access.userId === userId) {
        throw new ApiError("Нельзя изменять собственные роли.", 403, "self_role_assignment_forbidden");
      }
      const body = await readJson(request, 8 * 1024);
      const requested = [...new Set(Array.isArray(body.roles) ? body.roles.map(String) : [])];
      if (requested.length > 8 || requested.some((slug) => !ROLE_SLUG.test(slug))) {
        throw new ApiError("Некорректный список должностей.", 400, "invalid_roles");
      }
      const user = await db.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
      if (!user) throw new ApiError("Пользователь не найден.", 404, "user_not_found");
      await assertAssignableRoles(db, access, requested);
      const existingResult = await db.prepare("SELECT role_slug FROM staff_assignments WHERE user_id = ?")
        .bind(userId).all();
      const existing = (existingResult.results || []).map((row) => row.role_slug);
      const previouslyOwner = existing.includes("owner");
      if ((previouslyOwner || requested.includes("owner")) && !isOwner(access)) {
        throw new ApiError("Назначать или снимать Owner может только Owner.", 403, "owner_assignment_forbidden");
      }
      if (previouslyOwner && !requested.includes("owner")) {
        const ownerCount = await db.prepare(`
          SELECT COUNT(*) AS total FROM staff_assignments WHERE role_slug = 'owner'
        `).first();
        if (Number(ownerCount?.total || 0) <= 1) {
          throw new ApiError("Нельзя снять должность с последнего Owner.", 409, "last_owner");
        }
      }
      const now = new Date().toISOString();
      const statements = requested.length
        ? [db.prepare(`
            DELETE FROM staff_assignments WHERE user_id = ? AND role_slug NOT IN (${requested.map(() => "?").join(",")})
          `).bind(userId, ...requested)]
        : [db.prepare("DELETE FROM staff_assignments WHERE user_id = ?").bind(userId)];
      for (const slug of requested) {
        statements.push(db.prepare(`
          INSERT OR IGNORE INTO staff_assignments (user_id, role_slug, assigned_at, assigned_by)
          VALUES (?, ?, ?, ?)
        `).bind(userId, slug, now, access.userId || "owner-session"));
      }
      statements.push(await prepareAdminAudit(env, request, "staff.roles.update", userId, {
        before: existing,
        after: requested,
      }));
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

    const statusMatch = /^admin\/users\/([^/]+)\/(disable|enable)$/.exec(action);
    if (statusMatch) {
      const userId = decodeURIComponent(statusMatch[1]);
      const operation = statusMatch[2];
      const access = await requirePermission(request, env, `users.${operation}`);
      if (access.userId && access.userId === userId) {
        throw new ApiError("Нельзя изменить состояние собственного аккаунта.", 403, "self_account_change_forbidden");
      }
      const target = await db.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
      if (!target) throw new ApiError("Пользователь не найден.", 404, "user_not_found");
      const targetRoles = await db.prepare(`
        SELECT role_slug FROM staff_assignments WHERE user_id = ?
      `).bind(userId).all();
      if ((targetRoles.results || []).some((row) => row.role_slug === "owner") && !isOwner(access)) {
        throw new ApiError("Состояние Owner может изменить только Owner.", 403, "owner_required");
      }
      const now = new Date().toISOString();
      const statements = [
        db.prepare("UPDATE users SET disabled_at = ?, updated_at = ? WHERE id = ?")
          .bind(operation === "disable" ? now : null, now, userId),
      ];
      if (operation === "disable") {
        statements.push(db.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(userId));
      }
      statements.push(await prepareAdminAudit(env, request, `staff.user.${operation}`, userId));
      await db.batch(statements);
      return json({ ok: true, disabled: operation === "disable" });
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
    const access = await requirePermission(request, env, "roles.delete");
    await enforceRateLimit(env, request, "admin-role-delete", 15, 60 * 60);
    const slug = decodeURIComponent(match[1]);
    const role = await db.prepare("SELECT slug, is_system FROM staff_roles WHERE slug = ?").bind(slug).first();
    if (!role) throw new ApiError("Должность не найдена.", 404, "role_not_found");
    if (Number(role.is_system)) throw new ApiError("Системную должность нельзя удалить.", 409, "system_role");
    if (!isOwner(access) && access.userId) {
      const assignedToSelf = await db.prepare(`
        SELECT 1 AS present FROM staff_assignments WHERE user_id = ? AND role_slug = ?
      `).bind(access.userId, slug).first();
      if (assignedToSelf) throw new ApiError("Нельзя удалить собственную роль.", 403, "self_role_delete_forbidden");
    }
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
