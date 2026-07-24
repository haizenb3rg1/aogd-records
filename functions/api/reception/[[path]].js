import {
  ApiError,
  assertAllowedSearchParams,
  assertSameOrigin,
  auditAdminRequired,
  prepareAdminAudit,
  cleanText,
  enforceRateLimit,
  enforceSubjectRateLimit,
  getCurrentUser,
  json,
  readJson,
  requireAdmin,
  requireDatabase,
  safeError,
  sendEmail,
  verifyTurnstile,
} from "../../_lib/security.js";

const CATEGORIES = new Set(["question", "proposal", "technical", "complaint", "correction", "security"]);
const PRIVATE_ONLY_CATEGORIES = new Set(["complaint", "correction", "security"]);
const STATUSES = new Set(["pending", "needs_info", "published", "accepted", "rejected", "resolved", "archived"]);
const PUBLIC_STATUSES = new Set(["published", "accepted", "resolved"]);
const CONSENT_VERSION = "2026-07-24-reception-v1";

function route(params) {
  const value = Array.isArray(params.path) ? params.path.join("/") : params.path;
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function validId(value) {
  const id = String(value || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new ApiError("Некорректный идентификатор.", 400, "invalid_id");
  }
  return id;
}

function publicStatus(status) {
  return PUBLIC_STATUSES.has(status);
}

function publicThread(row, viewerId = "") {
  const anonymous = Boolean(row.is_anonymous);
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    status: row.status,
    author: anonymous ? "Анонимный участник" : row.nickname,
    anonymous,
    officialAnswer: row.official_answer || "",
    answeredAt: row.answered_at || "",
    publishedAt: row.published_at || "",
    updatedAt: row.updated_at,
    interestCount: Number(row.interest_count || 0),
    interested: Boolean(viewerId && row.viewer_interested),
  };
}

function ownerThread(row) {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    visibility: row.visibility,
    anonymous: Boolean(row.is_anonymous),
    status: row.status,
    officialAnswer: row.official_answer || "",
    moderatorNote: row.moderator_note || "",
    publishedAt: row.published_at || "",
    answeredAt: row.answered_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    interestCount: Number(row.interest_count || 0),
  };
}

function adminThread(row) {
  const anonymous = Boolean(row.is_anonymous);
  return {
    ...ownerThread(row),
    author: anonymous ? "Анонимный участник" : row.nickname,
    authorRevealRequired: anonymous,
  };
}

const BASE_SELECT = `
  SELECT
    r.*,
    u.nickname,
    (SELECT COUNT(*) FROM reception_interests i WHERE i.thread_id = r.id) AS interest_count
  FROM reception_threads r
  JOIN users u ON u.id = r.user_id
`;

async function requireVerifiedUser(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user || !user.verified_at) {
    throw new ApiError("Войдите в подтверждённый аккаунт.", 401, "authentication_required");
  }
  return user;
}

async function listPublic(request, env) {
  const db = requireDatabase(env);
  const viewer = await getCurrentUser(request, env);
  const result = await db.prepare(`
    SELECT
      r.*,
      u.nickname,
      (SELECT COUNT(*) FROM reception_interests i WHERE i.thread_id = r.id) AS interest_count,
      CASE WHEN ? <> '' AND EXISTS (
        SELECT 1 FROM reception_interests mine WHERE mine.thread_id = r.id AND mine.user_id = ?
      ) THEN 1 ELSE 0 END AS viewer_interested
    FROM reception_threads r
    JOIN users u ON u.id = r.user_id
    WHERE r.visibility = 'public'
      AND r.status IN ('published', 'accepted', 'resolved')
      AND r.published_at IS NOT NULL
    ORDER BY
      CASE r.status WHEN 'accepted' THEN 0 WHEN 'published' THEN 1 ELSE 2 END,
      COALESCE(r.answered_at, r.published_at) DESC
    LIMIT 100
  `).bind(viewer?.id || "", viewer?.id || "").all();
  return json(
    { threads: result.results.map((row) => publicThread(row, viewer?.id || "")) },
    200,
    {
      "Cache-Control": viewer ? "private, no-store" : "public, max-age=30, must-revalidate",
      Vary: "Cookie",
    },
  );
}

async function listMine(request, env) {
  const db = requireDatabase(env);
  const user = await requireVerifiedUser(request, env);
  const result = await db.prepare(`
    ${BASE_SELECT}
    WHERE r.user_id = ?
    ORDER BY r.created_at DESC
    LIMIT 100
  `).bind(user.id).all();
  return json({ threads: result.results.map(ownerThread) });
}

async function listAdmin(request, env) {
  const db = requireDatabase(env);
  await requireAdmin(request, env);
  await enforceRateLimit(env, request, "admin-reception-read", 180, 60 * 60);
  const result = await db.prepare(`
    ${BASE_SELECT}
    ORDER BY
      CASE r.status WHEN 'pending' THEN 0 WHEN 'needs_info' THEN 1 ELSE 2 END,
      r.created_at DESC
    LIMIT 250
  `).all();
  return json({ threads: result.results.map(adminThread) });
}

export async function onRequestGet({ request, env, params }) {
  try {
    const action = route(params);
    if (["public", "mine", "admin"].includes(action)) {
      assertAllowedSearchParams(request);
    }
    if (action === "public") return await listPublic(request, env);
    if (action === "mine") return await listMine(request, env);
    if (action === "admin") return await listAdmin(request, env);
    throw new ApiError("Маршрут не найден.", 404, "not_found");
  } catch (error) {
    return safeError(error, request, "Не удалось загрузить приёмную.");
  }
}

async function createThread(request, env) {
  const db = requireDatabase(env);
  const user = await requireVerifiedUser(request, env);
  await enforceRateLimit(env, request, "turnstile-reception-submit", 30, 60);
  const body = await readJson(request, 24 * 1024);
  await verifyTurnstile(env, request, body.turnstileToken, "reception_submit");
  await enforceRateLimit(env, request, "reception-create", 8, 24 * 60 * 60);
  await enforceSubjectRateLimit(env, "reception-user", user.id, 5, 24 * 60 * 60);

  const category = cleanText(body.category, 32);
  const title = cleanText(body.title, 140, 6);
  const description = cleanText(body.body, 5000, 30);
  const requestedVisibility = cleanText(body.visibility, 16);
  const isAnonymous = body.anonymous === true;
  if (!CATEGORIES.has(category)) {
    throw new ApiError("Выберите категорию обращения.", 400, "invalid_category");
  }
  if (!["public", "private"].includes(requestedVisibility)) {
    throw new ApiError("Выберите видимость обращения.", 400, "invalid_visibility");
  }
  if (PRIVATE_ONLY_CATEGORIES.has(category) && requestedVisibility !== "private") {
    throw new ApiError("Эта категория может быть только приватной.", 400, "private_category_required");
  }
  if (body.consent !== true || body.consentVersion !== CONSENT_VERSION) {
    throw new ApiError("Подтвердите правила публикации.", 400, "consent_required");
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO reception_threads (
      id, user_id, category, title, body, visibility, is_anonymous, status,
      consent_version, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).bind(
    id,
    user.id,
    category,
    title,
    description,
    requestedVisibility,
    isAnonymous ? 1 : 0,
    CONSENT_VERSION,
    now,
    now,
  ).run();

  if (env.SUPPORT_EMAIL && env.RESEND_API_KEY && env.EMAIL_FROM) {
    await sendEmail(env, {
      to: env.SUPPORT_EMAIL,
      subject: `Новое обращение в приёмной A.O.G.D: ${title}`,
      text: `Номер: ${id}\nКатегория: ${category}\nВидимость: ${requestedVisibility}\n\nОткройте административную панель для рассмотрения.`,
    }).catch(() => {});
  }
  return json({ thread: { id, status: "pending", createdAt: now } }, 201);
}

async function toggleInterest(request, env, id) {
  const db = requireDatabase(env);
  const user = await requireVerifiedUser(request, env);
  await enforceRateLimit(env, request, "reception-interest", 40, 60 * 60);
  await enforceSubjectRateLimit(env, "reception-interest-user", user.id, 80, 24 * 60 * 60);
  const body = await readJson(request, 2 * 1024);
  if (typeof body.interested !== "boolean") {
    throw new ApiError("Укажите желаемое состояние интереса.", 400, "invalid_interest_state");
  }
  const thread = await db.prepare(`
    SELECT id FROM reception_threads
    WHERE id = ? AND visibility = 'public'
      AND status IN ('published', 'accepted', 'resolved')
      AND published_at IS NOT NULL
  `).bind(id).first();
  if (!thread) throw new ApiError("Публикация не найдена.", 404, "not_found");
  if (body.interested) {
    await db.prepare("INSERT OR IGNORE INTO reception_interests (thread_id, user_id, created_at) VALUES (?, ?, ?)")
      .bind(id, user.id, new Date().toISOString()).run();
  } else {
    await db.prepare("DELETE FROM reception_interests WHERE thread_id = ? AND user_id = ?")
      .bind(id, user.id).run();
  }
  const count = await db.prepare(
    "SELECT COUNT(*) AS total FROM reception_interests WHERE thread_id = ?",
  ).bind(id).first();
  return json({ interested: body.interested, interestCount: Number(count?.total || 0) });
}

async function revealAuthor(request, env, id) {
  const db = requireDatabase(env);
  await requireAdmin(request, env);
  await enforceRateLimit(env, request, "admin-reception-reveal", 30, 60 * 60);
  const body = await readJson(request, 4 * 1024);
  const reason = cleanText(body.reason, 300, 10);
  const row = await db.prepare(`
    SELECT r.id, r.is_anonymous, u.id AS user_id, u.nickname, u.email, u.created_at
    FROM reception_threads r
    JOIN users u ON u.id = r.user_id
    WHERE r.id = ?
  `).bind(id).first();
  if (!row) throw new ApiError("Обращение не найдено.", 404, "not_found");
  if (!row.is_anonymous) {
    throw new ApiError("Автор этой публикации не скрыт.", 409, "author_not_anonymous");
  }
  await auditAdminRequired(env, request, "reception.author.reveal", id, { reason });
  return json({
    author: {
      userId: row.user_id,
      nickname: row.nickname,
      email: row.email,
      registeredAt: row.created_at,
    },
  });
}

export async function onRequestPost({ request, env, params }) {
  try {
    assertSameOrigin(request);
    const parts = route(params).split("/").filter(Boolean);
    if (!parts.length) return await createThread(request, env);
    if (parts.length === 2 && parts[1] === "interest") {
      return await toggleInterest(request, env, validId(parts[0]));
    }
    if (parts.length === 3 && parts[0] === "admin" && parts[2] === "reveal-author") {
      return await revealAuthor(request, env, validId(parts[1]));
    }
    throw new ApiError("Маршрут не найден.", 404, "not_found");
  } catch (error) {
    return safeError(error, request, "Не удалось выполнить действие.");
  }
}

export async function onRequestPut({ request, env, params }) {
  try {
    assertSameOrigin(request);
    const db = requireDatabase(env);
    await requireAdmin(request, env);
    await enforceRateLimit(env, request, "admin-reception-update", 120, 60 * 60);
    const parts = route(params).split("/").filter(Boolean);
    if (parts.length !== 2 || parts[0] !== "admin") {
      throw new ApiError("Маршрут не найден.", 404, "not_found");
    }
    const id = validId(parts[1]);
    const body = await readJson(request, 16 * 1024);
    const status = cleanText(body.status, 24);
    const officialAnswer = cleanText(body.officialAnswer, 5000);
    const moderatorNote = cleanText(body.moderatorNote, 1200);
    if (!STATUSES.has(status)) throw new ApiError("Недопустимый статус.", 400, "invalid_status");
    if (["accepted", "resolved"].includes(status) && !officialAnswer) {
      throw new ApiError("Для этого статуса добавьте официальный ответ.", 400, "answer_required");
    }

    const current = await db.prepare(`
      SELECT r.*, u.email
      FROM reception_threads r
      JOIN users u ON u.id = r.user_id
      WHERE r.id = ?
    `).bind(id).first();
    if (!current) throw new ApiError("Обращение не найдено.", 404, "not_found");
    if (current.visibility === "private" && status === "published") {
      throw new ApiError("Приватное обращение нельзя опубликовать.", 409, "private_thread");
    }
    const now = new Date().toISOString();
    const publishedAt = current.visibility === "public" && publicStatus(status)
      ? current.published_at || now
      : null;
    const answeredAt = officialAnswer ? current.answered_at || now : null;
    const update = db.prepare(`
      UPDATE reception_threads
      SET status = ?, official_answer = ?, moderator_note = ?,
          published_at = ?, answered_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      status,
      officialAnswer || null,
      moderatorNote || null,
      publishedAt,
      answeredAt,
      now,
      id,
    );
    const audit = await prepareAdminAudit(env, request, "reception.thread.update", id, {
      fromStatus: current.status,
      toStatus: status,
      answerChanged: (current.official_answer || "") !== officialAnswer,
    });
    await db.batch([update, audit]);
    if ((current.status !== status || (current.official_answer || "") !== officialAnswer)
      && env.RESEND_API_KEY && env.EMAIL_FROM) {
      await sendEmail(env, {
        to: current.email,
        subject: `Обновление обращения A.O.G.D: ${current.title}`,
        text: `Статус вашего обращения изменён. Войдите в личный кабинет A.O.G.D, чтобы увидеть ответ администрации.\n\nНомер обращения: ${id}`,
      }).catch(() => {});
    }
    return json({
      ok: true,
      thread: {
        id,
        status,
        officialAnswer,
        moderatorNote,
        publishedAt: publishedAt || "",
        answeredAt: answeredAt || "",
        updatedAt: now,
      },
    });
  } catch (error) {
    return safeError(error, request, "Не удалось обновить обращение.");
  }
}

export async function onRequestDelete({ request, env, params }) {
  try {
    assertSameOrigin(request);
    const db = requireDatabase(env);
    const user = await requireVerifiedUser(request, env);
    await enforceRateLimit(env, request, "reception-delete", 10, 24 * 60 * 60);
    const parts = route(params).split("/").filter(Boolean);
    if (parts.length !== 2 || parts[0] !== "mine") {
      throw new ApiError("Маршрут не найден.", 404, "not_found");
    }
    const id = validId(parts[1]);
    const result = await db.prepare("DELETE FROM reception_threads WHERE id = ? AND user_id = ?")
      .bind(id, user.id).run();
    if (!result.meta?.changes) throw new ApiError("Обращение не найдено.", 404, "not_found");
    return json({ ok: true });
  } catch (error) {
    return safeError(error, request, "Не удалось удалить обращение.");
  }
}

export function onRequest({ request }) {
  return json(
    { error: "Метод не поддерживается.", code: "method_not_allowed" },
    405,
    { Allow: "GET, POST, PUT, DELETE" },
  );
}
