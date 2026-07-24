import { ApiError, json, safeError } from "../../_lib/security.js";

const SAFE_KEY = /^records\/[0-9a-f-]{36}-[0-9]{10,16}\.(jpg|png|webp)$/i;
const SAFE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function objectKey(params) {
  const raw = Array.isArray(params.path) ? params.path.join("/") : params.path;
  let key;
  try {
    key = decodeURIComponent(String(raw || ""));
  } catch {
    throw new ApiError("Некорректный путь.", 400, "invalid_path");
  }
  if (!SAFE_KEY.test(key)) throw new ApiError("Некорректный путь.", 400, "invalid_path");
  return key;
}

export async function onRequestGet({ env, params, request }) {
  try {
    if (!env.MEDIA) throw new ApiError("Файл временно недоступен.", 503, "storage_unavailable");
    const object = await env.MEDIA.get(objectKey(params));
    if (!object) throw new ApiError("Файл не найден.", 404, "not_found");
    const contentType = object.httpMetadata?.contentType || "";
    if (!SAFE_TYPES.has(contentType)) {
      console.error("Rejected unsafe media metadata", { key: object.key, contentType });
      throw new ApiError("Файл недоступен.", 404, "not_found");
    }
    const etag = object.httpEtag;
    if (request.headers.get("If-None-Match") === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: etag,
          "Cache-Control": "public, max-age=31536000, immutable",
          "Cross-Origin-Resource-Policy": "same-origin",
        },
      });
    }
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Content-Type", contentType);
    headers.set("ETag", etag);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
    return new Response(object.body, { headers });
  } catch (error) {
    return safeError(error, request, "Не удалось загрузить файл.");
  }
}

export function onRequest({ request }) {
  return json(
    { error: "Метод не поддерживается.", code: "method_not_allowed" },
    405,
    { Allow: "GET" },
  );
}
