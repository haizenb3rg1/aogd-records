import { useEffect, useRef } from "react";

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";
let loader;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-aogd-turnstile="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.turnstile), { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.aogdTurnstile = "true";
    script.onload = () => resolve(window.turnstile);
    script.onerror = () => reject(new Error("Не удалось загрузить проверку безопасности."));
    document.head.appendChild(script);
  });
  return loader;
}

export function turnstileEnabled() {
  return Boolean(SITE_KEY);
}

export default function TurnstileWidget({ onToken, resetSignal = 0, action = "form" }) {
  const container = useRef(null);
  const widgetId = useRef(null);

  useEffect(() => {
    if (!SITE_KEY || !container.current) return undefined;
    let cancelled = false;
    loadTurnstile().then((turnstile) => {
      if (cancelled || !container.current || widgetId.current !== null) return;
      widgetId.current = turnstile.render(container.current, {
        sitekey: SITE_KEY,
        action,
        theme: "auto",
        appearance: "interaction-only",
        callback: (token) => onToken(token),
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
      });
    }).catch(() => onToken(""));
    return () => {
      cancelled = true;
      if (widgetId.current !== null && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, [action, onToken]);

  useEffect(() => {
    if (widgetId.current !== null && window.turnstile) {
      window.turnstile.reset(widgetId.current);
      onToken("");
    }
  }, [resetSignal, onToken]);

  if (!SITE_KEY) return null;
  return <div className="turnstile-widget" ref={container} aria-label="Проверка безопасности" />;
}
