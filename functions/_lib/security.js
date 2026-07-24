const encoder = new TextEncoder();
const USER_COOKIE = "__Host-aogd_session";
const ADMIN_COOKIE = "__Host-aogd_admin";
const MAX_JSON_BYTES = 64 * 1024;

export class ApiError extends Error {
  constructor(message, status = 400, code = "bad_request") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function requestId(request) {
  return request?.headers?.get("X-Request-ID") || request?.headers?.get("CF-Ray") || crypto.randomUUID();
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

export function assertBodySize(request, maxBytes) {
  const raw = request.headers.get("Content-Length");
  if (raw && Number(raw) > maxBytes) {
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
  try {
    return JSON.parse(new TextDecoder().decode(merged) || "{}");
  } catch {
    throw new ApiError("Некорректные данные формы.", 400, "invalid_json");
  }
}

export function normalizeEmail(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase().slice(0, 254);
}

export function normalizeNickname(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 32);
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
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(value).padStart(6, "0");
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
  const candidate = await hashPassword(password, salt, Number(iterations) || 210000);
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
  const token = cookies[USER_COOKIE] || cookies.aogd_session;
  if (!token || token.length > 256) return null;
  const tokenHash = await sha256(token);
  return env.DB.prepare(`
    SELECT u.id, u.email, u.nickname, u.verified_at, u.created_at
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled_at IS NULL
  `).bind(tokenHash, new Date().toISOString()).first();
}

export async function createAdminSession(env) {
  const db = requireDatabase(env);
  const token = randomToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString();
  await db.prepare("INSERT INTO admin_sessions (id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), await sha256(token), expiresAt, now.toISOString()).run();
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
  const userAgent = (request.headers.get("User-Agent") || "").slice(0, 200);
  const secret = env.RATE_LIMIT_SECRET || env.CODE_PEPPER || env.ADMIN_TOKEN;
  return hmacSha256(secret, `${scope}\n${ip}\n${userAgent}`);
}

export async function enforceRateLimit(env, request, scope, limit, windowSeconds) {
  const db = requireDatabase(env);
  const key = await privateClientKey(env, request, scope);
  const now = new Date();
  const nowIso = now.toISOString();
  const resetIso = new Date(now.getTime() + windowSeconds * 1000).toISOString();
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
  if (!env.DB || crypto.getRandomValues(new Uint8Array(1))[0] > 16) return;
  const now = new Date().toISOString();
  const auditCutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM user_sessions WHERE expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM email_codes WHERE expires_at <= ? OR used_at IS NOT NULL").bind(now),
    env.DB.prepare("DELETE FROM rate_limits WHERE reset_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM admin_audit_log WHERE created_at < ?").bind(auditCutoff),
  ]);
}

export async function auditAdmin(env, request, action, targetId = "", details = {}) {
  if (!env.DB) return;
  try {
    const actorHash = await privateClientKey(env, request, "admin-audit");
    await env.DB.prepare(`
      INSERT INTO admin_audit_log (id, actor_hash, action, target_id, details, request_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      actorHash,
      String(action).slice(0, 80),
      String(targetId || "").slice(0, 128),
      JSON.stringify(details).slice(0, 2000),
      requestId(request),
      new Date().toISOString(),
    ).run();
  } catch (error) {
    console.error("Audit log write failed", { requestId: requestId(request), message: error?.message });
  }
}

export async function validateImageFile(file, maxBytes) {
  if (!file || typeof file.arrayBuffer !== "function") return null;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new ApiError("Допустимы только JPG, PNG и WebP.", 400, "invalid_image_type");
  }
  if (file.size > maxBytes) throw new ApiError("Изображение слишком большое.", 413, "image_too_large");
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!jpeg && !png && !webp) throw new ApiError("Содержимое файла не соответствует изображению.", 400, "invalid_image_content");
  return file;
}

export async function sendEmail(env, { to, subject, text }) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new ApiError("Почтовая отправка временно недоступна.", 503, "email_unavailable");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "AOGD/2.0",
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text }),
  });
  if (!response.ok) {
    console.error("Email provider rejected request", { status: response.status });
    throw new ApiError("Не удалось отправить письмо. Попробуйте позже.", 503, "email_delivery_failed");
  }
}

export async function verifyTurnstile(env, request, token, expectedAction = "") {
  if (!env.TURNSTILE_SECRET_KEY) return;
  if (!token) throw new ApiError("Подтвердите, что вы не робот.", 400, "turnstile_required");
  const body = new FormData();
  body.set("secret", env.TURNSTILE_SECRET_KEY);
  body.set("response", String(token));
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) body.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const result = await response.json().catch(() => ({}));
  const expectedHostname = new URL(request.url).hostname;
  const wrongHostname = result.hostname && result.hostname !== expectedHostname;
  const wrongAction = expectedAction && result.action && result.action !== expectedAction;
  if (!result.success || wrongHostname || wrongAction) {
    throw new ApiError("Проверка безопасности не пройдена.", 400, "turnstile_failed");
  }
}
