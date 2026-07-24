const encoder = new TextEncoder();
const USER_COOKIE = "__Host-aogd_session";
const ADMIN_COOKIE = "__Host-aogd_admin";
const MAX_JSON_BYTES = 64 * 1024;
const MIN_PASSWORD_ITERATIONS = 100000;
const MAX_PASSWORD_ITERATIONS = 1000000;
const MAX_IMAGE_PIXELS = 16000000;

export class ApiError extends Error {
  constructor(message, status = 400, code = "bad_request") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function requestId(request) {
  const candidate = request?.headers?.get("X-Request-ID") || request?.headers?.get("CF-Ray") || "";
  return /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : crypto.randomUUID();
}

export function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  for (const [name, value] of Object.entries(extraHeaders)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  return Response.json(data, {
    status,
    headers,
  });
}

export function safeError(error, request, fallback = "Не удалось выполнить запрос.") {
  if (error instanceof ApiError) {
    return json({ error: error.message, code: error.code, requestId: requestId(request) }, error.status);
  }
  console.error("Unhandled API error", { requestId: requestId(request), name: error?.name, message: error?.message });
  return json({ error: fallback, code: "internal_error", requestId: requestId(request) }, 500);
}

export function requireDatabase(env) {
  if (!env.DB) throw new ApiError("Сервис временно недоступен.", 503, "service_unavailable");
  return env.DB;
}

export function assertSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new ApiError("Запрос отклонён.", 403, "origin_mismatch");
  }
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    throw new ApiError("Запрос отклонён.", 403, "cross_site_request");
  }
}

export function assertAllowedSearchParams(request, allowed = []) {
  const allowedNames = new Set(allowed);
  const seen = new Set();
  for (const [name] of new URL(request.url).searchParams) {
    if (!allowedNames.has(name) || seen.has(name)) {
      throw new ApiError("Некорректные параметры запроса.", 400, "invalid_query");
    }
    seen.add(name);
  }
}

export function assertBodySize(request, maxBytes) {
  const contentEncoding = request.headers.get("Content-Encoding")?.trim().toLowerCase();
  if (contentEncoding && contentEncoding !== "identity") {
    throw new ApiError("Сжатые запросы не поддерживаются.", 415, "unsupported_content_encoding");
  }
  const raw = request.headers.get("Content-Length")?.trim();
  if (raw && (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > maxBytes)) {
    throw new ApiError("Запрос слишком большой.", 413, "payload_too_large");
  }
}

export async function readJson(request, maxBytes = MAX_JSON_BYTES) {
  assertBodySize(request, maxBytes);
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new ApiError("Запрос слишком большой.", 413, "payload_too_large");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(merged) || "{}");
  } catch {
    throw new ApiError("Некорректные данные формы.", 400, "invalid_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError("Ожидался JSON-объект.", 400, "invalid_json");
  }
  return parsed;
}

export async function readFormData(request, maxBytes = MAX_JSON_BYTES) {
  assertBodySize(request, maxBytes);
  const reader = request.body?.getReader();
  if (!reader) return new FormData();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new ApiError("Запрос слишком большой.", 413, "payload_too_large");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(request.headers);
  headers.delete("Content-Encoding");
  headers.delete("Transfer-Encoding");
  headers.set("Content-Length", String(size));
  try {
    return await new Request(request.url, {
      method: request.method,
      headers,
      body: merged,
    }).formData();
  } catch {
    throw new ApiError("Некорректные данные формы.", 400, "invalid_form");
  }
}

export function normalizeEmail(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase();
}

export function normalizeNickname(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function cleanText(value, maxLength, minLength = 0) {
  const text = String(value || "").normalize("NFKC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (text.length < minLength) throw new ApiError(`Минимальная длина: ${minLength} символов.`, 400, "too_short");
  if (text.length > maxLength) throw new ApiError(`Максимальная длина: ${maxLength} символов.`, 400, "too_long");
  return text;
}

export function isValidEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

export function isValidNickname(value) {
  return /^[\p{L}\p{N}_.-]{3,32}$/u.test(value);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value)));
  return bytesToBase64(new Uint8Array(digest));
}

export async function hmacSha256(secret, value) {
  if (!secret) throw new ApiError("Сервис временно недоступен.", 503, "secret_missing");
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(String(value)));
  return bytesToBase64(new Uint8Array(signature));
}

export function randomToken(size = 32) {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(size)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function randomCode() {
  const range = 0x100000000;
  const limit = range - (range % 1000000);
  let value;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (value >= limit);
  return String(value % 1000000).padStart(6, "0");
}

export async function hashPassword(password, salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16))), iterations = 600000) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: base64ToBytes(salt), iterations },
    key,
    256,
  );
  return { hash: bytesToBase64(new Uint8Array(bits)), salt, iterations };
}

export async function verifyPassword(password, expectedHash, salt, iterations = 210000) {
  const normalizedIterations = Number(iterations);
  if (
    !Number.isSafeInteger(normalizedIterations)
    || normalizedIterations < MIN_PASSWORD_ITERATIONS
    || normalizedIterations > MAX_PASSWORD_ITERATIONS
  ) return false;
  const candidate = await hashPassword(password, salt, normalizedIterations);
  return timingSafeEqual(candidate.hash, expectedHash);
}

export function timingSafeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function parseCookies(request) {
  const result = {};
  for (const item of (request.headers.get("Cookie") || "").split(";")) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    const key = separator < 0 ? trimmed : trimmed.slice(0, separator);
    const value = separator < 0 ? "" : trimmed.slice(separator + 1);
    try { result[key] = decodeURIComponent(value); } catch { result[key] = ""; }
  }
  return result;
}

function secureCookie(name, value, maxAge, sameSite = "Lax") {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${maxAge}; Priority=High`;
}

export function sessionCookie(token, maxAge = 60 * 60 * 24 * 30) {
  return secureCookie(USER_COOKIE, token, maxAge, "Lax");
}

export function clearSessionCookie() {
  return [
    secureCookie(USER_COOKIE, "", 0, "Lax"),
    "aogd_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
  ];
}

export function adminCookie(token, maxAge = 60 * 60 * 8) {
  return secureCookie(ADMIN_COOKIE, token, maxAge, "Strict");
}

export function clearAdminCookie() {
  return secureCookie(ADMIN_COOKIE, "", 0, "Strict");
}

export async function getCurrentUser(request, env) {
  if (!env.DB) return null;
  const cookies = parseCookies(request);
  const token = cookies[USER_COOKIE];
  if (!token || token.length > 256) return null;
  const tokenHash = await sha256(token);
  return env.DB.prepare(`
    SELECT u.id, u.email, u.nickname, u.verified_at, u.created_at
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled_at IS NULL
  `).bind(tokenHash, new Date().toISOString()).first();
}

export async function createAdminSession(env, additionalStatements = []) {
  const db = requireDatabase(env);
  const token = randomToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString();
  const insert = db.prepare("INSERT INTO admin_sessions (id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), await sha256(token), expiresAt, now.toISOString());
  if (additionalStatements.length) await db.batch([insert, ...additionalStatements]);
  else await insert.run();
  return token;
}

export async function isAdmin(request, env) {
  if (!env.DB) return false;
  const token = parseCookies(request)[ADMIN_COOKIE];
  if (!token || token.length > 256) return false;
  const row = await env.DB.prepare("SELECT id FROM admin_sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(await sha256(token), new Date().toISOString()).first();
  return Boolean(row);
}

export async function requireAdmin(request, env) {
  if (!(await isAdmin(request, env))) throw new ApiError("Требуется вход администратора.", 401, "admin_auth_required");
}

function hasConfiguredValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function configurationStatus(env = {}) {
  const emailDelivery = hasConfiguredValue(env.RESEND_API_KEY) && hasConfiguredValue(env.EMAIL_FROM);
  return {
    database: Boolean(env.DB),
    mediaStorage: Boolean(env.MEDIA),
    adminToken: hasConfiguredValue(env.ADMIN_TOKEN) && String(env.ADMIN_TOKEN).length >= 20,
    adminSecondFactor: hasConfiguredValue(env.ADMIN_TOTP_SECRET),
    dedicatedRateLimitSecret: hasConfiguredValue(env.RATE_LIMIT_SECRET),
    dedicatedCodePepper: hasConfiguredValue(env.CODE_PEPPER),
    emailDelivery,
    supportNotifications: emailDelivery && hasConfiguredValue(env.SUPPORT_EMAIL),
    turnstileServer: hasConfiguredValue(env.TURNSTILE_SECRET_KEY),
  };
}

export async function verifyAdminSecret(secret, env) {
  if (!env.ADMIN_TOKEN || String(env.ADMIN_TOKEN).length < 20) {
    throw new ApiError("Сервис администрирования не настроен.", 503, "admin_not_configured");
  }
  return timingSafeEqual(await sha256(secret), await sha256(env.ADMIN_TOKEN));
}

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const input = String(value || "").toUpperCase().replace(/[\s=-]/g, "");
  let bits = "";
  for (const character of input) {
    const index = alphabet.indexOf(character);
    if (index < 0) return new Uint8Array();
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return new Uint8Array(bytes);
}

async function totpAt(secret, counter) {
  const keyBytes = decodeBase32(secret);
  if (keyBytes.length < 16) return "";
  const message = new Uint8Array(8);
  let value = BigInt(counter);
  for (let index = 7; index >= 0; index -= 1) {
    message[index] = Number(value & 255n);
    value >>= 8n;
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary = (
    ((signature[offset] & 0x7f) << 24)
    | (signature[offset + 1] << 16)
    | (signature[offset + 2] << 8)
    | signature[offset + 3]
  );
  return String(binary % 1000000).padStart(6, "0");
}

export async function verifyAdminSecondFactor(code, env) {
  if (!env.ADMIN_TOTP_SECRET) return true;
  const normalized = String(code || "").replace(/\D/g, "");
  if (normalized.length !== 6) return false;
  const counter = Math.floor(Date.now() / 30000);
  const candidates = await Promise.all([-1, 0, 1].map((offset) => totpAt(env.ADMIN_TOTP_SECRET, counter + offset)));
  return candidates.some((candidate) => timingSafeEqual(candidate, normalized));
}

async function privateClientKey(env, request, scope) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const secret = env.RATE_LIMIT_SECRET || env.CODE_PEPPER || env.ADMIN_TOKEN;
  return hmacSha256(secret, `${scope}\n${ip}`);
}

export async function enforceRateLimit(env, request, scope, limit, windowSeconds) {
  const db = requireDatabase(env);
  const key = await privateClientKey(env, request, scope);
  const now = new Date();
  const nowIso = now.toISOString();
  const resetIso = new Date(now.getTime() + windowSeconds * 1000).toISOString();
  const existing = await db.prepare("SELECT count, reset_at FROM rate_limits WHERE key = ?").bind(key).first();
  if (existing && existing.reset_at > nowIso && Number(existing.count || 0) >= limit) {
    const retry = Math.max(1, Math.ceil((new Date(existing.reset_at).getTime() - now.getTime()) / 1000));
    throw new ApiError(`Слишком много запросов. Повторите через ${retry} сек.`, 429, "rate_limited");
  }
  const row = await db.prepare(`
    INSERT INTO rate_limits (key, scope, count, reset_at, updated_at)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN rate_limits.reset_at <= excluded.updated_at THEN 1 ELSE rate_limits.count + 1 END,
      reset_at = CASE WHEN rate_limits.reset_at <= excluded.updated_at THEN excluded.reset_at ELSE rate_limits.reset_at END,
      updated_at = excluded.updated_at
    RETURNING count, reset_at
  `).bind(key, scope, resetIso, nowIso).first();
  if (Number(row?.count || 0) > limit) {
    const retry = Math.max(1, Math.ceil((new Date(row.reset_at).getTime() - now.getTime()) / 1000));
    throw new ApiError(`Слишком много запросов. Повторите через ${retry} сек.`, 429, "rate_limited");
  }
}

export async function enforceSubjectRateLimit(env, scope, subject, limit, windowSeconds) {
  const db = requireDatabase(env);
  const secret = env.RATE_LIMIT_SECRET || env.CODE_PEPPER || env.ADMIN_TOKEN;
  const key = await hmacSha256(secret, `${scope}\n${String(subject || "").normalize("NFKC").toLowerCase()}`);
  const now = new Date();
  const nowIso = now.toISOString();
  const resetIso = new Date(now.getTime() + windowSeconds * 1000).toISOString();
  const existing = await db.prepare("SELECT count, reset_at FROM rate_limits WHERE key = ?").bind(key).first();
  if (existing && existing.reset_at > nowIso && Number(existing.count || 0) >= limit) {
    throw new ApiError("Слишком много попыток. Повторите позже.", 429, "rate_limited");
  }
  const row = await db.prepare(`
    INSERT INTO rate_limits (key, scope, count, reset_at, updated_at)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN rate_limits.reset_at <= excluded.updated_at THEN 1 ELSE rate_limits.count + 1 END,
      reset_at = CASE WHEN rate_limits.reset_at <= excluded.updated_at THEN excluded.reset_at ELSE rate_limits.reset_at END,
      updated_at = excluded.updated_at
    RETURNING count, reset_at
  `).bind(key, scope, resetIso, nowIso).first();
  if (Number(row?.count || 0) > limit) {
    throw new ApiError("Слишком много попыток. Повторите позже.", 429, "rate_limited");
  }
}

export async function cleanupExpired(env) {
  if (!env.DB) return;
  const now = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const lease = await env.DB.prepare(`
    INSERT INTO rate_limits (key, scope, count, reset_at, updated_at)
    VALUES ('__system_cleanup__', 'system-cleanup', 1, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      count = 1,
      reset_at = excluded.reset_at,
      updated_at = excluded.updated_at
    WHERE rate_limits.reset_at <= excluded.updated_at
    RETURNING key
  `).bind(leaseUntil, now).first();
  if (!lease) return;
  const auditCutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const guestSupportCutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM user_sessions WHERE expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM email_codes WHERE expires_at <= ? OR used_at IS NOT NULL").bind(now),
    env.DB.prepare("DELETE FROM rate_limits WHERE reset_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM admin_audit_log WHERE created_at < ?").bind(auditCutoff),
    env.DB.prepare(`
      DELETE FROM support_requests
      WHERE user_id IS NULL AND updated_at < ?
    `).bind(guestSupportCutoff),
  ]);
}

export async function auditAdmin(env, request, action, targetId = "", details = {}) {
  if (!env.DB) return;
  try {
    await (await prepareAdminAudit(env, request, action, targetId, details)).run();
  } catch (error) {
    console.error("Audit log write failed", { requestId: requestId(request), message: error?.message });
  }
}

export async function prepareAdminAudit(
  env,
  request,
  action,
  targetId = "",
  details = {},
  { onlyIfPreviousChange = false } = {},
) {
  if (!env.DB) throw new ApiError("Служебный журнал временно недоступен.", 503, "audit_unavailable");
  const actorHash = await privateClientKey(env, request, "admin-audit");
  const sql = onlyIfPreviousChange
    ? `
      INSERT INTO admin_audit_log (id, actor_hash, action, target_id, details, request_id, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?
      WHERE changes() > 0
    `
    : `
      INSERT INTO admin_audit_log (id, actor_hash, action, target_id, details, request_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
  return env.DB.prepare(sql).bind(
    crypto.randomUUID(),
    actorHash,
    String(action).slice(0, 80),
    String(targetId || "").slice(0, 128),
    JSON.stringify(details).slice(0, 2000),
    requestId(request),
    new Date().toISOString(),
  );
}

export async function auditAdminRequired(env, request, action, targetId = "", details = {}) {
  try {
    await (await prepareAdminAudit(env, request, action, targetId, details)).run();
  } catch (error) {
    console.error("Required audit log write failed", { requestId: requestId(request), message: error?.message });
    if (error instanceof ApiError) throw error;
    throw new ApiError("Не удалось записать обязательное событие аудита.", 503, "audit_unavailable");
  }
}

export function imageContentType(bytes) {
  if (!(bytes instanceof Uint8Array)) return "";
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const webp = bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (jpeg) return "image/jpeg";
  if (png) return "image/png";
  if (webp) return "image/webp";
  return "";
}

export function imageDimensions(bytes, contentType) {
  if (!(bytes instanceof Uint8Array)) return null;
  if (contentType === "image/png") {
    if (bytes.length < 24 || String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (contentType === "image/webp") {
    if (bytes.length < 30) return null;
    const kind = String.fromCharCode(...bytes.slice(12, 16));
    if (kind === "VP8X") {
      const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
      return { width, height };
    }
    if (kind === "VP8L" && bytes[20] === 0x2f) {
      const width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
      const height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
      return { width, height };
    }
    if (kind === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
      const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
      return { width, height };
    }
    return null;
  }
  if (contentType === "image/jpeg") {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset];
      offset += 1;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = (bytes[offset] << 8) | bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) break;
      const startOfFrame = [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
        0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
      ].includes(marker);
      if (startOfFrame && length >= 7) {
        const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
        const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
        return { width, height };
      }
      offset += length;
    }
  }
  return null;
}

function fourCc(bytes, offset) {
  return String.fromCharCode(...bytes.slice(offset, offset + 4));
}

export function isAnimatedImage(bytes, contentType) {
  if (!(bytes instanceof Uint8Array)) return true;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (contentType === "image/png") {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      const type = fourCc(bytes, offset + 4);
      if (type === "acTL") return true;
      const next = offset + 12 + length;
      if (!Number.isSafeInteger(next) || next <= offset || next > bytes.length) break;
      if (type === "IEND") break;
      offset = next;
    }
    return false;
  }
  if (contentType === "image/webp") {
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const type = fourCc(bytes, offset);
      const length = view.getUint32(offset + 4, true);
      if (type === "ANIM" || type === "ANMF") return true;
      if (type === "VP8X" && length >= 1 && offset + 8 < bytes.length && (bytes[offset + 8] & 0x02)) return true;
      const next = offset + 8 + length + (length % 2);
      if (!Number.isSafeInteger(next) || next <= offset || next > bytes.length) break;
      offset = next;
    }
  }
  return false;
}

export function isSafeImageContent(bytes, contentType) {
  if (imageContentType(bytes) !== contentType) return false;
  if (isAnimatedImage(bytes, contentType)) return false;
  const dimensions = imageDimensions(bytes, contentType);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) return false;
  return dimensions.width <= 12000
    && dimensions.height <= 12000
    && dimensions.width * dimensions.height <= MAX_IMAGE_PIXELS;
}

export async function validateImageFile(file, maxBytes) {
  if (!file || typeof file.arrayBuffer !== "function") return null;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new ApiError("Допустимы только JPG, PNG и WebP.", 400, "invalid_image_type");
  }
  const fileSize = Number(file.size);
  if (!Number.isSafeInteger(fileSize) || fileSize < 1 || fileSize > maxBytes) {
    throw new ApiError("Изображение слишком большое.", 413, "image_too_large");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isSafeImageContent(bytes, file.type)) {
    throw new ApiError("Содержимое или размеры изображения недопустимы.", 400, "invalid_image_content");
  }
  return file;
}

export async function sendEmail(env, { to, subject, text }) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new ApiError("Почтовая отправка временно недоступна.", 503, "email_unavailable");
  }
  const safeSubject = String(subject || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  if (!safeSubject) throw new ApiError("Некорректная тема письма.", 400, "invalid_email_subject");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "AOGD/2.0",
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject: safeSubject, text }),
  });
  if (!response.ok) {
    console.error("Email provider rejected request", { status: response.status });
    throw new ApiError("Не удалось отправить письмо. Попробуйте позже.", 503, "email_delivery_failed");
  }
}

export async function verifyTurnstile(env, request, token, expectedAction = "") {
  if (!env.TURNSTILE_SECRET_KEY) {
    const hostname = new URL(request.url).hostname;
    if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
      throw new ApiError("Проверка безопасности временно недоступна.", 503, "turnstile_unavailable");
    }
    return;
  }
  if (!token) throw new ApiError("Подтвердите, что вы не робот.", 400, "turnstile_required");
  if (String(token).length > 2048) throw new ApiError("Некорректная проверка безопасности.", 400, "turnstile_failed");
  const body = new FormData();
  body.set("secret", env.TURNSTILE_SECRET_KEY);
  body.set("response", String(token));
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) body.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const result = await response.json().catch(() => ({}));
  const expectedHostname = new URL(request.url).hostname;
  const wrongHostname = result.hostname !== expectedHostname;
  const wrongAction = Boolean(expectedAction && result.action !== expectedAction);
  if (!result.success || wrongHostname || wrongAction) {
    throw new ApiError("Проверка безопасности не пройдена.", 400, "turnstile_failed");
  }
}
