import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { resources, DEFAULT_LOCALE, NS } from "./config";
import type { Locale } from "./config";

let initialized = false;

// Called once by each island root before first render. Idempotent after the
// first call; subsequent calls with a different locale do nothing because the
// toggle triggers a full-page reload, making re-init unnecessary at runtime.
export function initClientI18n(locale: Locale): void {
  if (initialized) return;
  initialized = true;

  void i18next.use(initReactI18next).init({
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    ns: [NS],
    defaultNS: NS,
    resources,
    interpolation: { escapeValue: false },
    // Synchronous init — resources are bundled, no async fetch needed.
    initImmediate: false,
  });
}
