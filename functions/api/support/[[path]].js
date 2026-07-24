import {
  ApiError,
  assertAllowedSearchParams,
  assertSameOrigin,
  prepareAdminAudit,
  cleanText,
  enforceRateLimit,
  enforceSubjectRateLimit,
  getCurrentUser,
  isSafeImageContent,
  isValidEmail,
  json,
  normalizeEmail,
  readJson,
  requirePermission,
  requireDatabase,
  readFormData,
  safeError,
  sendEmail,
  sha256,
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
    photoUrl: row.has_photo ? `/api/support/photo/${encodeURIComponent(row.id)}` : "",
    status: row.status,
    ...(includeContact ? { moderatorNote: row.moderator_note || "" } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_REQUESTS = `
  SELECT
    s.id, s.user_id, s.guest_email, s.telegram_username, s.category,
    s.subject, s.description, s.status, s.moderator_note, s.created_at, s.updated_at,
    CASE WHEN s.photo_data IS NOT NULL THEN 1 ELSE 0 END AS has_photo,
    u.nickname, u.email AS account_email
  FROM support_requests s
  LEFT JOIN users u ON u.id = s.user_id
`;

function decodeStoredPhoto(value) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(value || ""));
  if (!match) return null;
  let binary;
  try {
    binary = atob(match[2]);
  } catch {
    return null;
  }
  if (!binary || binary.length > MAX_PHOTO_SIZE) return null;
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (!isSafeImageContent(bytes, match[1])) return null;
  return { contentType: match[1], bytes };
}

async function storedPhotoResponse(request, env, db, id) {
  await enforceRateLimit(env, request, "support-photo-read", 120, 60 * 60);
  const metadata = await db.prepare(`
    SELECT user_id, CASE WHEN photo_data IS NOT NULL THEN 1 ELSE 0 END AS has_photo
    FROM support_requests
    WHERE id = ?
  `).bind(id).first();
  if (!metadata?.has_photo) throw new ApiError("Файл не найден.", 404, "not_found");
  const user = await getCurrentUser(request, env);
  if (!user || user.id !== metadata.user_id) await requirePermission(request, env, "support.read");
  const row = await db.prepare("SELECT photo_data FROM support_requests WHERE id = ?").bind(id).first();
  const photo = decodeStoredPhoto(row?.photo_data);
  if (!photo) throw new ApiError("Файл не найден.", 404, "not_found");
  const etag = `"${await sha256(row.photo_data)}"`;
  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  }
  return new Response(photo.bytes, {
    headers: {
      "Content-Type": photo.contentType,
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      ETag: etag,
      "Content-Length": String(photo.bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

export async function onRequestGet({ request, env, params }) {
  try {
    const action = route(params);
    const photoMatch = /^photo\/([^/]+)$/.exec(action);
    if (!photoMatch && action !== "mine" && action !== "admin") {
      throw new ApiError("Маршрут не найден.", 404, "not_found");
    }
    assertAllowedSearchParams(request);
    const db = requireDatabase(env);
    if (photoMatch) return await storedPhotoResponse(request, env, db, validId(photoMatch[1]));
    if (action === "mine") {
      const user = await getCurrentUser(request, env);
      if (!user) throw new ApiError("Войдите в аккаунт.", 401, "authentication_required");
      await enforceRateLimit(env, request, "support-mine-read", 60, 60 * 60);
      const result = await db.prepare(`${SELECT_REQUESTS} WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 50`)
        .bind(user.id)
        .all();
      return json({ requests: result.results.map((row) => mapRequest(row, false)) });
    }
    if (action === "admin") {
      await requirePermission(request, env, "support.read");
      await enforceRateLimit(env, request, "admin-support-read", 120, 60 * 60);
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
    const db = requireDatabase(env);
    if (route(params)) throw new ApiError("Маршрут не найден.", 404, "not_found");
    const user = await getCurrentUser(request, env);

    await enforceRateLimit(env, request, "turnstile-support-submit", 30, 60);
    const form = await readFormData(request, MAX_FORM_SIZE);
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
    await enforceRateLimit(env, request, user ? "support-user" : "support-guest", user ? 6 : 3, 60 * 60);
    if (!user) await enforceSubjectRateLimit(env, "support-guest-email", guestEmail, 5, 24 * 60 * 60);
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
      await sendEmail(env, {
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
    await requirePermission(request, env, "support.update");
    await enforceRateLimit(env, request, "admin-support-update", 120, 60 * 60);
    const parts = route(params).split("/").filter(Boolean);
    if (parts[0] !== "admin" || !parts[1]) throw new ApiError("Маршрут не найден.", 404, "not_found");
    const id = validId(parts[1]);
    const body = await readJson(request, 8 * 1024);
    const status = cleanText(body.status, 24);
    const moderatorNote = cleanText(body.moderatorNote, 1000);
    if (!STATUSES.has(status)) throw new ApiError("Недопустимый статус.", 400, "invalid_status");
    const now = new Date().toISOString();
    const update = db.prepare(`
      UPDATE support_requests
      SET status = ?, moderator_note = ?, updated_at = ?
      WHERE id = ?
    `).bind(status, moderatorNote || null, now, id);
    const audit = await prepareAdminAudit(env, request, "support.status.update", id, { status });
    const [result] = await db.batch([update, audit]);
    if (!result.meta?.changes) throw new ApiError("Обращение не найдено.", 404, "not_found");
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
