const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const MAX_INLINE_PHOTO_SIZE = 900 * 1024;
const ALLOWED_PHOTOS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const FIELDS = [
  "fileNumber", "fullName", "aliases", "status", "priority", "nationality", "birthDate", "gender",
  "height", "eyes", "hair", "languages", "residence", "telegramUsername", "lastSeen", "publicationBasis", "description",
  "identifyingMarks", "contactNote",
];

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function decodeAdminToken(value) {
  try {
    const binary = atob(value);
    return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  } catch {
    return "";
  }
}

async function isAuthorized(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) return false;
  const [candidate, expected] = await Promise.all([digest(decodeAdminToken(header.slice(7))), digest(env.ADMIN_TOKEN)]);
  if (candidate.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < candidate.length; index += 1) difference |= candidate[index] ^ expected[index];
  return difference === 0;
}

function requireDatabase(env) {
  if (!env.DB) throw new Response(JSON.stringify({ error: "База D1 не подключена." }), { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  return env.DB;
}

function normalize(raw) {
  const record = {};
  for (const field of FIELDS) record[field] = typeof raw?.[field] === "string" ? raw[field].trim().slice(0, field === "description" ? 6000 : 1600) : "";
  if (!record.fullName) throw new Error("Укажите полное имя.");
  if (!record.publicationBasis) throw new Error("Укажите основание публикации.");
  if (!["wanted", "priority", "located", "archived"].includes(record.status)) record.status = "wanted";
  if (!["critical", "high", "medium", "low"].includes(record.priority)) record.priority = "medium";
  return record;
}

function rowToRecord(row) {
  const data = JSON.parse(row.data || "{}");
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
    throw new Error("Без R2 фотография должна быть меньше 900 КБ.");
  }
  const bytes = new Uint8Array(await photo.arrayBuffer());
  return `data:${photo.type};base64,${bytesToBase64(bytes)}`;
}

function idFromParams(params) {
  const value = Array.isArray(params.path) ? params.path.join("/") : params.path;
  return value ? decodeURIComponent(value) : "";
}

async function readForm(request) {
  const form = await request.formData();
  let raw;
  try { raw = JSON.parse(String(form.get("record") || "{}")); }
  catch { throw new Error("Некорректные данные формы."); }
  const photo = form.get("photo");
  if (photo && typeof photo === "object" && "size" in photo) {
    if (!ALLOWED_PHOTOS.has(photo.type)) throw new Error("Допустимы только JPG, PNG и WebP.");
    if (photo.size > MAX_PHOTO_SIZE) throw new Error("Фотография должна быть меньше 5 МБ.");
  }
  return { record: normalize(raw), photo: photo && typeof photo === "object" && photo.size ? photo : null, removePhoto: form.get("removePhoto") === "true" };
}

async function getExisting(db, id) {
  return db.prepare("SELECT * FROM records WHERE id = ?").bind(id).first();
}

async function assertAdmin(request, env) {
  if (!env.ADMIN_TOKEN) return json({ error: "Секрет ADMIN_TOKEN не настроен в Cloudflare." }, 503);
  if (!(await isAuthorized(request, env))) return json({ error: "Неверный пароль администратора." }, 401);
  return null;
}

export async function onRequestGet({ env, params }) {
  try {
    const db = requireDatabase(env);
    const id = idFromParams(params);
    if (id) {
      const row = await getExisting(db, id);
      return row ? json({ record: rowToRecord(row) }) : json({ error: "Запись не найдена." }, 404);
    }
    const result = await db.prepare("SELECT * FROM records ORDER BY updated_at DESC").all();
    return json({ records: result.results.map(rowToRecord) });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error: "Не удалось загрузить базу." }, 500);
  }
}

export async function onRequestPost({ request, env, params }) {
  const denied = await assertAdmin(request, env); if (denied) return denied;
  try {
    if (idFromParams(params)) return json({ error: "Некорректный адрес для новой записи." }, 400);
    const db = requireDatabase(env);
    const { record, photo } = await readForm(request);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    record.fileNumber ||= `AOGD-${new Date().getUTCFullYear()}-${id.slice(0, 6).toUpperCase()}`;
    let photoKey = "";
    if (photo) {
      if (env.MEDIA) {
        photoKey = `${id}-${Date.now()}.${ALLOWED_PHOTOS.get(photo.type)}`;
        await env.MEDIA.put(photoKey, photo.stream(), { httpMetadata: { contentType: photo.type } });
      } else {
        record.photoDataUrl = await photoToDataUrl(photo);
      }
    }
    await db.prepare("INSERT INTO records (id, file_number, full_name, status, data, photo_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, record.fileNumber, record.fullName, record.status, JSON.stringify(record), photoKey || null, now, now).run();
    return json({ record: rowToRecord({ id, file_number: record.fileNumber, full_name: record.fullName, status: record.status, data: JSON.stringify(record), photo_key: photoKey, created_at: now, updated_at: now }) }, 201);
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error: error.message || "Не удалось создать запись." }, 400);
  }
}

export async function onRequestPut({ request, env, params }) {
  const denied = await assertAdmin(request, env); if (denied) return denied;
  let uploadedKey = "";
  try {
    const db = requireDatabase(env);
    const id = idFromParams(params);
    if (!id) return json({ error: "Не указан идентификатор записи." }, 400);
    const existing = await getExisting(db, id);
    if (!existing) return json({ error: "Запись не найдена." }, 404);
    const { record, photo, removePhoto } = await readForm(request);
    const existingData = JSON.parse(existing.data || "{}");
    record.fileNumber ||= existing.file_number;
    if (!removePhoto && existingData.photoDataUrl) record.photoDataUrl = existingData.photoDataUrl;
    let photoKey = existing.photo_key || "";
    if (photo) {
      if (env.MEDIA) {
        uploadedKey = `${id}-${Date.now()}.${ALLOWED_PHOTOS.get(photo.type)}`;
        await env.MEDIA.put(uploadedKey, photo.stream(), { httpMetadata: { contentType: photo.type } });
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
    await db.prepare("UPDATE records SET file_number = ?, full_name = ?, status = ?, data = ?, photo_key = ?, updated_at = ? WHERE id = ?")
      .bind(record.fileNumber, record.fullName, record.status, JSON.stringify(record), photoKey || null, now, id).run();
    if (env.MEDIA && existing.photo_key && existing.photo_key !== photoKey) await env.MEDIA.delete(existing.photo_key);
    return json({ record: rowToRecord({ id, file_number: record.fileNumber, full_name: record.fullName, status: record.status, data: JSON.stringify(record), photo_key: photoKey, created_at: existing.created_at, updated_at: now }) });
  } catch (error) {
    if (uploadedKey && env.MEDIA) await env.MEDIA.delete(uploadedKey);
    if (error instanceof Response) return error;
    return json({ error: error.message || "Не удалось обновить запись." }, 400);
  }
}

export async function onRequestDelete({ request, env, params }) {
  const denied = await assertAdmin(request, env); if (denied) return denied;
  try {
    const db = requireDatabase(env);
    const id = idFromParams(params);
    if (!id) return json({ error: "Не указан идентификатор записи." }, 400);
    const existing = await getExisting(db, id);
    if (!existing) return json({ error: "Запись не найдена." }, 404);
    await db.prepare("DELETE FROM records WHERE id = ?").bind(id).run();
    if (env.MEDIA && existing.photo_key) await env.MEDIA.delete(existing.photo_key);
    return json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error: "Не удалось удалить запись." }, 500);
  }
}

export function onRequest() {
  return json({ error: "Метод не поддерживается." }, 405);
}
