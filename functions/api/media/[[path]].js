function error(message, status) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function onRequestGet({ env, params, request }) {
  if (!env.MEDIA) return error("Хранилище фотографий не подключено.", 503);
  const key = Array.isArray(params.path) ? params.path.join("/") : params.path;
  if (!key || key.includes("..")) return error("Некорректный путь.", 400);
  const object = await env.MEDIA.get(key);
  if (!object) return error("Файл не найден.", 404);

  const etag = object.httpEtag;
  if (request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", etag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
}

export function onRequest() {
  return error("Метод не поддерживается.", 405);
}
