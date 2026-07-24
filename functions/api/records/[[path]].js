import {
  ApiError,
  assertAllowedSearchParams,
  assertSameOrigin,
  prepareAdminAudit,
  cleanText,
  enforceRateLimit,
  isSafeImageContent,
  json,
  requireAdmin,
  requireDatabase,
  readFormData,
  safeError,
  sha256,
  validateImageFile,
} from "../../_lib/security.js";

const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const MAX_INLINE_PHOTO_SIZE = 900 * 1024;
const MAX_FORM_SIZE = 6 * 1024 * 1024;
const PUBLIC_PAGE_SIZE = 100;
const PUBLIC_PAGE_COUNT = 5;
const ALLOWED_PHOTOS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const FIELD_LIMITS = {
  fileNumber: 80,
  fullName: 180,
  aliases: 500,
  status: 24,
  priority: 24,
  nationality: 160,
  birthDate: 40,
  gender: 80,
  height: 80,
  eyes: 100,
  hair: 100,
  languages: 500,
  residence: 500,
  telegramUsername: 64,
  lastSeen: 1600,
  publicationBasis: 2000,
  description: 6000,
  identifyingMarks: 2000,
  contactNote: 1600,
};

function normalize(raw) {
  const record = {};
  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    record[field] = cleanText(raw?.[field], limit);
  }
  if (record.fullName.length < 2) throw new ApiError("Укажите полное имя.", 400, "full_name_required");
  if (record.publicationBasis.length < 10) {
    throw new ApiError("Подробно укажите основание публикации.", 400, "publication_basis_required");
  }
  if (!["wanted", "priority", "located", "archived"].includes(record.status)) record.status = "wanted";
  if (!["critical", "high", "medium", "low"].includes(record.priority)) record.priority = "medium";
  if (record.telegramUsername && !/^@[A-Za-z0-9_]{5,32}$/.test(record.telegramUsername)) {
    throw new ApiError("Укажите Telegram username в формате @username.", 400, "invalid_telegram_username");
  }
  if (record.fileNumber && !/^[\p{L}\p{N}._/-]{3,80}$/u.test(record.fileNumber)) {
    throw new ApiError("Номер досье содержит недопустимые символы.", 400, "invalid_file_number");
  }
  return record;
}

function parseData(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function publicRecordData(data) {
  const result = {};
  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    result[field] = String(data?.[field] ?? "")
      .normalize("NFKC")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .slice(0, limit);
  }
  return result;
}

function rowToRecord(row) {
  const data = parseData(row.data);
  const hasInlinePhoto = Boolean(row.has_inline_photo || data.photoDataUrl);
  return {
    ...publicRecordData(data),
    id: row.id,
    fileNumber: row.file_number,
    fullName: row.full_name,
    status: row.status,
    photoUrl: row.photo_key
      ? `/api/media/${encodeURIComponent(row.photo_key)}`
      : (hasInlinePhoto ? `/api/records/${encodeURIComponent(row.id)}/photo` : ""),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const PUBLIC_RECORD_SELECT = `
  SELECT
    id, file_number, full_name, status,
    CASE
      WHEN json_valid(data) THEN json_remove(data, '$.photoDataUrl')
      ELSE '{}'
    END AS data,
    CASE
      WHEN json_valid(data) THEN
        CASE WHEN json_type(data, '$.photoDataUrl') IS NOT NULL THEN 1 ELSE 0 END
      ELSE 0
    END AS has_inline_photo,
    photo_key, created_at, updated_at
  FROM records
`;

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function photoToDataUrl(photo) {
  if (photo.size > MAX_INLINE_PHOTO_SIZE) {
    throw new ApiError("Без R2 фотография должна быть меньше 900 КБ.", 413, "inline_image_too_large");
  }
  const bytes = new Uint8Array(await photo.arrayBuffer());
  return `data:${photo.type};base64,${bytesToBase64(bytes)}`;
}

function idFromParams(params, required = false) {
  const value = Array.isArray(params.path) ? params.path.join("/") : params.path;
  if (!value && !required) return "";
  let decoded;
  try {
    decoded = decodeURIComponent(String(value || ""));
  } catch {
    throw new ApiError("Некорректный идентификатор.", 400, "invalid_id");
  }
  if (!/^[0-9a-f-]{36}$/i.test(decoded)) throw new ApiError("Некорректный идентификатор.", 400, "invalid_id");
  return decoded;
}

function idFromValue(value, required = false) {
  if (!value && !required) return "";
  let decoded;
  try {
    decoded = decodeURIComponent(String(value || ""));
  } catch {
    throw new ApiError("Некорректный идентификатор.", 400, "invalid_id");
  }
  if (!/^[0-9a-f-]{36}$/i.test(decoded)) throw new ApiError("Некорректный идентификатор.", 400, "invalid_id");
  return decoded;
}

function decodeInlinePhoto(value) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(value || ""));
  if (!match) return null;
  let binary;
  try {
    binary = atob(match[2]);
  } catch {
    return null;
  }
  if (!binary || binary.length > MAX_INLINE_PHOTO_SIZE) return null;
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (!isSafeImageContent(bytes, match[1])) return null;
  return { contentType: match[1], bytes };
}

async function inlinePhotoResponse(request, db, id) {
  const row = await db.prepare(`
    SELECT CASE
      WHEN json_valid(data) THEN json_extract(data, '$.photoDataUrl')
      ELSE NULL
    END AS photo_data
    FROM records
    WHERE id = ?
  `)
    .bind(id)
    .first();
  const photo = decodeInlinePhoto(row?.photo_data);
  if (!photo) throw new ApiError("Файл не найден.", 404, "not_found");
  const etag = `"${await sha256(row.photo_data)}"`;
  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, {
      status: 304,
      headers: {
          ETag: etag,
          "Cache-Control": "public, max-age=300, must-revalidate",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  }
  return new Response(photo.bytes, {
    headers: {
      "Content-Type": photo.contentType,
      "Cache-Control": "public, max-age=300, must-revalidate",
      ETag: etag,
      "Content-Length": String(photo.bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

async function readForm(request) {
  const form = await readFormData(request, MAX_FORM_SIZE);
  let raw;
  try {
    raw = JSON.parse(String(form.get("record") || "{}"));
  } catch {
    throw new ApiError("Некорректные данные формы.", 400, "invalid_record_json");
  }
  const photo = form.get("photo");
  if (photo && typeof photo === "object" && "size" in photo && photo.size) {
    await validateImageFile(photo, MAX_PHOTO_SIZE);
  }
  return {
    record: normalize(raw),
    photo: photo && typeof photo === "object" && photo.size ? photo : null,
    removePhoto: form.get("removePhoto") === "true",
  };
}

function getExisting(db, id) {
  return db.prepare("SELECT * FROM records WHERE id = ?").bind(id).first();
}

function recordConflict() {
  return new ApiError(
    "Запись была изменена другим администратором. Обновите страницу.",
    409,
    "record_conflict",
  );
}

function mediaUploadKey(id, contentType) {
  const extension = ALLOWED_PHOTOS.get(contentType);
  return `records/${id}-${crypto.randomUUID()}.${extension}`;
}

async function deleteMediaObject(env, key) {
  if (!env.MEDIA || !key) return;
  try {
    await env.MEDIA.delete(key);
  } catch {
    // Storage cleanup is best effort; the database remains the source of truth.
  }
}

async function authorizeMutation(request, env, scope) {
  assertSameOrigin(request);
  await requireAdmin(request, env);
  await enforceRateLimit(env, request, scope, 120, 60 * 60);
}

export async function onRequestGet({ request, env, params }) {
  try {
    const rawPath = Array.isArray(params.path) ? params.path.join("/") : String(params.path || "");
    const photoMatch = /^([^/]+)\/photo$/.exec(rawPath);
    if (photoMatch) {
      assertAllowedSearchParams(request);
      const db = requireDatabase(env);
      return await inlinePhotoResponse(request, db, idFromValue(photoMatch[1], true));
    }
    const id = idFromParams(params);
    assertAllowedSearchParams(request, id ? [] : ["page"]);
    const db = requireDatabase(env);
    if (id) {
      const row = await getExisting(db, id);
      if (!row) throw new ApiError("Запись не найдена.", 404, "not_found");
      return json({ record: rowToRecord(row) }, 200, { "Cache-Control": "public, max-age=30, must-revalidate" });
    }
    const pageValue = new URL(request.url).searchParams.get("page") || "0";
    if (!/^[0-4]$/.test(pageValue)) throw new ApiError("Некорректная страница.", 400, "invalid_page");
    const page = Number(pageValue);
    const result = await db.prepare(`
      ${PUBLIC_RECORD_SELECT}
      ORDER BY updated_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).bind(PUBLIC_PAGE_SIZE, page * PUBLIC_PAGE_SIZE).all();
    const records = result.results.map(rowToRecord);
    const nextPage = records.length === PUBLIC_PAGE_SIZE && page < PUBLIC_PAGE_COUNT - 1 ? page + 1 : null;
    return json({ records, nextPage }, 200, { "Cache-Control": "public, max-age=30, must-revalidate" });
  } catch (error) {
    return safeError(error, request, "Не удалось загрузить базу.");
  }
}

export async function onRequestPost({ request, env, params }) {
  let uploadedKey = "";
  try {
    await authorizeMutation(request, env, "admin-record-create");
    if (idFromParams(params)) throw new ApiError("Некорректный адрес для новой записи.", 400, "invalid_route");
    const db = requireDatabase(env);
    const { record, photo } = await readForm(request);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    record.fileNumber ||= `AOGD-${new Date().getUTCFullYear()}-${id.slice(0, 6).toUpperCase()}`;
    let photoKey = "";
    if (photo) {
      if (env.MEDIA) {
        uploadedKey = mediaUploadKey(id, photo.type);
        await env.MEDIA.put(uploadedKey, photo.stream(), {
          httpMetadata: { contentType: photo.type, cacheControl: "public, max-age=300, must-revalidate" },
          customMetadata: { recordId: id },
        });
        photoKey = uploadedKey;
      } else {
        record.photoDataUrl = await photoToDataUrl(photo);
      }
    }
    const insert = db.prepare(`
      INSERT INTO records (id, file_number, full_name, status, data, photo_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      record.fileNumber,
      record.fullName,
      record.status,
      JSON.stringify(record),
      photoKey || null,
      now,
      now,
    );
    const audit = await prepareAdminAudit(env, request, "record.create", id, { status: record.status });
    await db.batch([insert, audit]);
    uploadedKey = "";
    return json({
      record: rowToRecord({
        id,
        file_number: record.fileNumber,
        full_name: record.fullName,
        status: record.status,
        data: JSON.stringify(record),
        photo_key: photoKey,
        created_at: now,
        updated_at: now,
      }),
    }, 201);
  } catch (error) {
    await deleteMediaObject(env, uploadedKey);
    return safeError(error, request, "Не удалось создать запись.");
  }
}

export async function onRequestPut({ request, env, params }) {
  let uploadedKey = "";
  try {
    await authorizeMutation(request, env, "admin-record-update");
    const db = requireDatabase(env);
    const id = idFromParams(params, true);
    const existing = await getExisting(db, id);
    if (!existing) throw new ApiError("Запись не найдена.", 404, "not_found");
    const { record, photo, removePhoto } = await readForm(request);
    const existingData = parseData(existing.data);
    record.fileNumber ||= existing.file_number;
    if (!removePhoto && existingData.photoDataUrl) record.photoDataUrl = existingData.photoDataUrl;
    let photoKey = existing.photo_key || "";
    if (photo) {
      if (env.MEDIA) {
        uploadedKey = mediaUploadKey(id, photo.type);
        await env.MEDIA.put(uploadedKey, photo.stream(), {
          httpMetadata: { contentType: photo.type, cacheControl: "public, max-age=300, must-revalidate" },
          customMetadata: { recordId: id },
        });
        photoKey = uploadedKey;
        delete record.photoDataUrl;
      } else {
        record.photoDataUrl = await photoToDataUrl(photo);
        photoKey = "";
      }
    } else if (removePhoto) {
      photoKey = "";
      delete record.photoDataUrl;
    }
    const now = new Date().toISOString();
    const previousPhotoKey = existing.photo_key || null;
    const serializedData = JSON.stringify(record);
    const update = db.prepare(`
      UPDATE records
      SET file_number = ?, full_name = ?, status = ?, data = ?, photo_key = ?, updated_at = ?
      WHERE id = ?
        AND updated_at = ?
        AND data = ?
        AND (
          photo_key = ?
          OR (photo_key IS NULL AND ? IS NULL)
        )
    `).bind(
      record.fileNumber,
      record.fullName,
      record.status,
      serializedData,
      photoKey || null,
      now,
      id,
      existing.updated_at,
      existing.data,
      previousPhotoKey,
      previousPhotoKey,
    );
    const audit = await prepareAdminAudit(
      env,
      request,
      "record.update",
      id,
      { status: record.status },
      { onlyIfPreviousChange: true },
    );
    const mutation = await db.batch([update, audit]);
    const updateResult = mutation[0];
    if (!updateResult.meta?.changes) throw recordConflict();

    // The new object is now referenced by the committed row. Never let a
    // later error path delete it as if the update had failed.
    uploadedKey = "";
    if (previousPhotoKey && previousPhotoKey !== (photoKey || null)) {
      await deleteMediaObject(env, previousPhotoKey);
    }
    return json({
      record: rowToRecord({
        id,
        file_number: record.fileNumber,
        full_name: record.fullName,
        status: record.status,
        data: serializedData,
        photo_key: photoKey,
        created_at: existing.created_at,
        updated_at: now,
      }),
    });
  } catch (error) {
    await deleteMediaObject(env, uploadedKey);
    return safeError(error, request, "Не удалось обновить запись.");
  }
}

export async function onRequestDelete({ request, env, params }) {
  try {
    await authorizeMutation(request, env, "admin-record-delete");
    const db = requireDatabase(env);
    const id = idFromParams(params, true);
    const existing = await getExisting(db, id);
    if (!existing) throw new ApiError("Запись не найдена.", 404, "not_found");
    const previousPhotoKey = existing.photo_key || null;
    const remove = db.prepare(`
      DELETE FROM records
      WHERE id = ?
        AND updated_at = ?
        AND data = ?
        AND (
          photo_key = ?
          OR (photo_key IS NULL AND ? IS NULL)
        )
    `).bind(
      id,
      existing.updated_at,
      existing.data,
      previousPhotoKey,
      previousPhotoKey,
    );
    const audit = await prepareAdminAudit(
      env,
      request,
      "record.delete",
      id,
      {},
      { onlyIfPreviousChange: true },
    );
    const mutation = await db.batch([remove, audit]);
    const removeResult = mutation[0];
    if (!removeResult.meta?.changes) throw recordConflict();
    await deleteMediaObject(env, previousPhotoKey);
    return json({ ok: true });
  } catch (error) {
    return safeError(error, request, "Не удалось удалить запись.");
  }
}

export function onRequest({ request }) {
  return json(
    { error: "Метод не поддерживается.", code: "method_not_allowed" },
    405,
    { Allow: "GET, POST, PUT, DELETE" },
  );
}
