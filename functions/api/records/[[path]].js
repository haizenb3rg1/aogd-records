import {
  ApiError,
  assertBodySize,
  assertSameOrigin,
  auditAdmin,
  cleanText,
  enforceRateLimit,
  json,
  requireAdmin,
  requireDatabase,
  safeError,
  validateImageFile,
} from "../../_lib/security.js";

const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const MAX_INLINE_PHOTO_SIZE = 900 * 1024;
const MAX_FORM_SIZE = 6 * 1024 * 1024;
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

function rowToRecord(row) {
  const data = parseData(row.data);
  return {
    ...data,
    id: row.id,
    fileNumber: row.file_number,
    fullName: row.full_name,
    status: row.status,
    photoUrl: row.photo_key ? `/api/media/${encodeURIComponent(row.photo_key)}` : (data.photoDataUrl || ""),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

async function readForm(request) {
  assertBodySize(request, MAX_FORM_SIZE);
  const form = await request.formData();
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

async function authorizeMutation(request, env, scope) {
  assertSameOrigin(request);
  await requireAdmin(request, env);
  await enforceRateLimit(env, request, scope, 120, 60 * 60);
}

export async function onRequestGet({ request, env, params }) {
  try {
    const db = requireDatabase(env);
    const id = idFromParams(params);
    if (id) {
      const row = await getExisting(db, id);
      if (!row) throw new ApiError("Запись не найдена.", 404, "not_found");
      return json({ record: rowToRecord(row) });
    }
    const result = await db.prepare("SELECT * FROM records ORDER BY updated_at DESC LIMIT 500").all();
    return json({ records: result.results.map(rowToRecord) });
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
        uploadedKey = `records/${id}-${Date.now()}.${ALLOWED_PHOTOS.get(photo.type)}`;
        await env.MEDIA.put(uploadedKey, photo.stream(), {
          httpMetadata: { contentType: photo.type, cacheControl: "public, max-age=31536000, immutable" },
          customMetadata: { recordId: id },
        });
        photoKey = uploadedKey;
      } else {
        record.photoDataUrl = await photoToDataUrl(photo);
      }
    }
    await db.prepare(`
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
    ).run();
    uploadedKey = "";
    await auditAdmin(env, request, "record.create", id, { status: record.status });
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
    if (uploadedKey && env.MEDIA) await env.MEDIA.delete(uploadedKey).catch(() => {});
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
        uploadedKey = `records/${id}-${Date.now()}.${ALLOWED_PHOTOS.get(photo.type)}`;
        await env.MEDIA.put(uploadedKey, photo.stream(), {
          httpMetadata: { contentType: photo.type, cacheControl: "public, max-age=31536000, immutable" },
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
    await db.prepare(`
      UPDATE records
      SET file_number = ?, full_name = ?, status = ?, data = ?, photo_key = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      record.fileNumber,
      record.fullName,
      record.status,
      JSON.stringify(record),
      photoKey || null,
      now,
      id,
    ).run();
    uploadedKey = "";
    if (env.MEDIA && existing.photo_key && existing.photo_key !== photoKey) {
      await env.MEDIA.delete(existing.photo_key).catch(() => {});
    }
    await auditAdmin(env, request, "record.update", id, { status: record.status });
    return json({
      record: rowToRecord({
        id,
        file_number: record.fileNumber,
        full_name: record.fullName,
        status: record.status,
        data: JSON.stringify(record),
        photo_key: photoKey,
        created_at: existing.created_at,
        updated_at: now,
      }),
    });
  } catch (error) {
    if (uploadedKey && env.MEDIA) await env.MEDIA.delete(uploadedKey).catch(() => {});
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
    await db.prepare("DELETE FROM records WHERE id = ?").bind(id).run();
    if (env.MEDIA && existing.photo_key) await env.MEDIA.delete(existing.photo_key).catch(() => {});
    await auditAdmin(env, request, "record.delete", id);
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
