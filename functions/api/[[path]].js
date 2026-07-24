import { json, requestId } from "../_lib/security.js";

export function onRequest({ request }) {
  return json(
    {
      error: "Маршрут не найден.",
      code: "not_found",
      requestId: requestId(request),
    },
    404,
  );
}
