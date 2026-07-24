import {
  ApiError,
  assertBodySize,
  assertSameOrigin,
  auditAdmin,
  cleanText,
  enforceRateLimit,
  getCurrentUser,
  isValidEmail,
  json,
  normalizeEmail,
  readJson,
  requireAdmin,
  requireDatabase,
  safeError,
  sendEmail,
  validateImageFile,
  verifyTurnstile,
} from "../../_lib/security.js";

const MAX_PHOTO_SIZE = 700 * 1024;
const MAX_FORM_SIZE = 1024 * 1024;
const CATEGORIES = new Set(["technical", "correction", "report", "other"]);
const STATUSES = new Set(["pending", "approved", "rejected", "resolved"]);

function route(params) {
  const value = Array.isArray(params.path) ? params.path.join("/") : params.path;
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function validId(value) {
  const id = String(value || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError("Некорректный идентификатор.", 400, "invalid_id");
  return id;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function photoToDataUrl(photo) {
  await validateImageFile(photo, MAX_PHOTO_SIZE);
  const bytes = new Uint8Array(await photo.arrayBuffer());
  return `data:${photo.type};base64,${bytesToBase64(bytes)}`;
}

function mapRequest(row, includeContact = false) {
  return {
    id: row.id,
    nickname: row.nickname || "",
    ...(includeContact ? { email: row.account_email || row.guest_email || "" } : {}),
    telegramUsername: row.telegram_username || "",
    category: row.category,
    subject: row.subject,
    description: row.description,
    photoUrl: row.photo_data || "",
    status: row.status,
    moderatorNote: row.moderator_note || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_REQUESTS = `
  SELECT s.*, u.nickname, u.email AS account_email
  FROM support_requests s
  LEFT JOIN users u ON u.id = s.user_id
`;

export async function onRequestGet({ request, env, params }) {
  try {
    const db = requireDatabase(env);
    const action = route(params);
    if (action === "mine") {
      const user = await getCurrentUser(request, env);
      if (!user) throw new ApiError("Войдите в аккаунт.", 401, "authentication_required");
      const result = await db.prepare(`${SELECT_REQUESTS} WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 50`)
        .bind(user.id)
        .all();
      return json({ requests: result.results.map((row) => mapRequest(row, false)) });
    }
    if (action === "admin") {
      await requireAdmin(request, env);
      const result = await db.prepare(`
        ${SELECT_REQUESTS}
        ORDER BY CASE s.status WHEN 'pending' THEN 0 ELSE 1 END, s.created_at DESC
        LIMIT 200
      `).all();
      return json({ requests: result.results.map((row) => mapRequest(row, true)) });
    }
    throw new ApiError("Маршрут не найден.", 404, "not_found");
  } catch (error) {
    return safeError(error, request, "Не удалось загрузить обращения.");
  }
}

export async function onRequestPost({ request, env, params }) {
  try {
    assertSameOrigin(request);
    assertBodySize(request, MAX_FORM_SIZE);
    const db = requireDatabase(env);
    if (route(params)) throw new ApiError("Маршрут не найден.", 404, "not_found");
    const user = await getCurrentUser(request, env);
    await enforceRateLimit(env, request, user ? "support-user" : "support-guest", user ? 6 : 3, 60 * 60);

    const form = await request.formData();
    await verifyTurnstile(env, request, form.get("turnstileToken"), "support_submit");
    if (form.get("agreement") !== "true") {
      throw new ApiError("Подтвердите согласие с правилами отправки.", 400, "agreement_required");
    }
    const guestEmail = user ? "" : normalizeEmail(form.get("email"));
    if (!user && (!guestEmail || !isValidEmail(guestEmail))) {
      throw new ApiError("Для ответа укажите корректную почту.", 400, "invalid_email");
    }
    const category = cleanText(form.get("category"), 32);
    const subject = cleanText(form.get("subject"), 120, 4);
    const description = cleanText(form.get("description"), 4000, 20);
    const telegramUsername = cleanText(form.get("telegramUsername"), 64);
    if (!CATEGORIES.has(category)) throw new ApiError("Выберите категорию обращения.", 400, "invalid_category");
    if (telegramUsername && !/^@[A-Za-z0-9_]{5,32}$/.test(telegramUsername)) {
      throw new ApiError("Укажите Telegram username в формате @username.", 400, "invalid_telegram_username");
    }
    const photo = form.get("photo");
    const photoData = photo && typeof photo === "object" && photo.size ? await photoToDataUrl(photo) : null;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO support_requests (
        id, user_id, guest_email, telegram_username, category, subject,
        description, photo_data, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).bind(
      id,
      user?.id || null,
      guestEmail || null,
      telegramUsername || null,
      category,
      subject,
      description,
      photoData,
      now,
      now,
    ).run();

    if (env.SUPPORT_EMAIL && env.RESEND_API_KEY && env.EMAIL_FROM) {
      sendEmail(env, {
        to: env.SUPPORT_EMAIL,
        subject: `Новое обращение A.O.G.D: ${subject}`,
        text: `Номер: ${id}\nКатегория: ${category}\nОтправитель: ${user?.nickname || guestEmail}\n\nОткройте административную панель для рассмотрения.`,
      }).catch(() => {});
    }
    return json({ request: { id, status: "pending", createdAt: now } }, 201);
  } catch (error) {
    return safeError(error, request, "Не удалось отправить обращение.");
  }
}

export async function onRequestPut({ request, env, params }) {
  try {
    assertSameOrigin(request);
    const db = requireDatabase(env);
    await requireAdmin(request, env);
    await enforceRateLimit(env, request, "admin-support-update", 120, 60 * 60);
    const parts = route(params).split("/").filter(Boolean);
    if (parts[0] !== "admin" || !parts[1]) throw new ApiError("Маршрут не найден.", 404, "not_found");
    const id = validId(parts[1]);
    const body = await readJson(request, 8 * 1024);
    const status = cleanText(body.status, 24);
    const moderatorNote = cleanText(body.moderatorNote, 1000);
    if (!STATUSES.has(status)) throw new ApiError("Недопустимый статус.", 400, "invalid_status");
    const now = new Date().toISOString();
    const result = await db.prepare(`
      UPDATE support_requests
      SET status = ?, moderator_note = ?, updated_at = ?
      WHERE id = ?
    `).bind(status, moderatorNote || null, now, id).run();
    if (!result.meta?.changes) throw new ApiError("Обращение не найдено.", 404, "not_found");
    await auditAdmin(env, request, "support.status.update", id, { status });
    return json({ ok: true, status, moderatorNote, updatedAt: now });
  } catch (error) {
    return safeError(error, request, "Не удалось изменить обращение.");
  }
}

export function onRequest({ request }) {
  return json(
    { error: "Метод не поддерживается.", code: "method_not_allowed" },
    405,
    { Allow: "GET, POST, PUT" },
  );
}
