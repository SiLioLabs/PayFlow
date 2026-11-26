/**
 * Minimal i18n module — no external dependencies.
 *
 * Usage:
 *   const { t } = useTranslation();
 *   t("subscribe.title")                    // → "New Subscription"
 *   t("common.error.prefix", { message })   // → "Error: Insufficient allowance"
 *
 * Missing keys:
 *   In development and test environments `t()` throws a ReferenceError so
 *   missing-key bugs are caught at test time rather than silently falling back
 *   to the raw key. In production it falls back to the key string.
 *
 * Adding a language:
 *   1. Create `src/i18n/<locale>.ts` with the same key set as `en.ts`.
 *   2. Add the entry to CATALOGS below.
 *   3. The LanguageSwitcher component will automatically surface the new locale.
 */
import React, { createContext, useCallback, useContext, useState } from "react";
import { en } from "./en";

// ── Catalog registry ──────────────────────────────────────────────────────────

type Catalog = Record<string, string>;

const CATALOGS: Record<string, Catalog> = {
  en,
};

export type LocaleCode = keyof typeof CATALOGS;

export const SUPPORTED_LOCALES: { code: LocaleCode; label: string }[] = [
  { code: "en", label: "English" },
];

// ── Missing-key policy ────────────────────────────────────────────────────────

/**
 * Throw on missing keys in non-production environments so tests catch gaps.
 * In production fall back to the key itself — never crash a live user.
 */
function missingKey(key: string, locale: string): string {
  const isProd =
    typeof process !== "undefined" &&
    (process.env as Record<string, string>).NODE_ENV === "production";
  if (!isProd) {
    throw new ReferenceError(
      `[i18n] Missing translation key "${key}" for locale "${locale}". ` +
        `Add it to src/i18n/${locale}.ts.`,
    );
  }
  return key;
}

// ── Translation function ──────────────────────────────────────────────────────

/**
 * Resolve `key` from `catalog`, interpolating any `{placeholder}` tokens.
 * Throws in dev/test when a key is absent.
 */
export function translateWith(
  catalog: Catalog,
  locale: string,
  key: string,
  vars?: Record<string, string>,
): string {
  const template = key in catalog ? catalog[key] : missingKey(key, locale);
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? `{${name}}`);
}

// ── Context ───────────────────────────────────────────────────────────────────

interface I18nContextValue {
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
  t: (key: string, vars?: Record<string, string>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

interface I18nProviderProps {
  children: React.ReactNode;
  /** Override the initial locale (useful in tests). Defaults to "en". */
  initialLocale?: LocaleCode;
}

export function I18nProvider({ children, initialLocale = "en" }: I18nProviderProps) {
  const [locale, setLocale] = useState<LocaleCode>(initialLocale);

  const t = useCallback(
    (key: string, vars?: Record<string, string>) => {
      const catalog = CATALOGS[locale] ?? CATALOGS["en"];
      return translateWith(catalog, locale, key, vars);
    },
    [locale],
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Fallback when used outside a provider (e.g. in tests that render
    // components without I18nProvider). Returns the English catalog directly
    // so individual component tests don't need to wrap with I18nProvider.
    const fallbackT = (key: string, vars?: Record<string, string>) =>
      translateWith(en, "en", key, vars);
    return {
      locale: "en",
      setLocale: () => {},
      t: fallbackT,
    };
  }
  return ctx;
}
