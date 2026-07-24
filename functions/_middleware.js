const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "script-src-attr 'none'",
  "connect-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

export async function onRequest(context) {
  const candidateRequestId = context.request.headers.get("CF-Ray") || "";
  const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(candidateRequestId)
    ? candidateRequestId
    : crypto.randomUUID();
  if (context.data) context.data.requestId = requestId;
  const requestHeaders = new Headers(context.request.headers);
  requestHeaders.set("X-Request-ID", requestId);
  const request = new Request(context.request, { headers: requestHeaders });
  const contentLength = Number(context.request.headers.get("Content-Length") || 0);
  if (context.request.url.includes("/api/") && contentLength > 7 * 1024 * 1024) {
    return Response.json(
      { error: "Запрос слишком большой.", code: "payload_too_large", requestId },
      { status: 413, headers: { "Cache-Control": "no-store", "X-Request-ID": requestId } },
    );
  }

  const response = await context.next(request);
  const next = new Response(response.body, response);
  next.headers.set("X-Request-ID", requestId);
  next.headers.set("X-Content-Type-Options", "nosniff");
  next.headers.set("X-Frame-Options", "DENY");
  next.headers.set("X-Permitted-Cross-Domain-Policies", "none");
  next.headers.set("X-XSS-Protection", "0");
  next.headers.set("Referrer-Policy", "no-referrer");
  next.headers.set("Permissions-Policy", "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()");
  next.headers.set("Content-Security-Policy", CSP);
  next.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  next.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  next.headers.set("Origin-Agent-Cluster", "?1");
  next.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (new URL(context.request.url).pathname.startsWith("/api/") && !next.headers.has("Cache-Control")) {
    next.headers.set("Cache-Control", "no-store");
  }
  return next;
}
