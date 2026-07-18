function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(hash);
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

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_TOKEN) return json({ error: "Секрет ADMIN_TOKEN не настроен в Cloudflare." }, 503);
  if (!(await isAuthorized(request, env))) return json({ error: "Неверный пароль администратора." }, 401);
  return json({ ok: true });
}

export function onRequest() {
  return json({ error: "Метод не поддерживается." }, 405);
}
