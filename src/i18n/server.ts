import i18next from "i18next";
import { resources, DEFAULT_LOCALE, NS } from "./config";
import type { Locale } from "./config";

// Initialized once at module load; never call changeLanguage() on this instance —
// concurrent Workers requests share this module and would race.
const serverInstance = i18next.createInstance();
void serverInstance.init({
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  ns: [NS],
  defaultNS: NS,
  resources,
  interpolation: { escapeValue: false },
});

export function getT(locale: Locale) {
  return serverInstance.getFixedT(locale);
}
