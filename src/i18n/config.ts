import en from "./locales/en.json";
import pl from "./locales/pl.json";

export const LOCALES = ["en", "pl"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const NS = "translation" as const;

export const resources = {
  en: { translation: en },
  pl: { translation: pl },
} as const;
