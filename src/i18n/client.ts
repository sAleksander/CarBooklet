import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { resources, DEFAULT_LOCALE, NS } from "./config";
import type { Locale } from "./config";

// Creates a per-render i18next instance. Safe for concurrent SSR requests under
// Cloudflare Workers — each call gets its own independent instance, no shared state.
export function createClientI18n(locale: Locale) {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    ns: [NS],
    defaultNS: NS,
    resources,
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return instance;
}
