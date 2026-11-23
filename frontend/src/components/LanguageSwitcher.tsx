/**
 * LanguageSwitcher — renders a `<select>` that lets the user switch the UI
 * language at runtime.
 *
 * Supported locales are discovered from the SUPPORTED_LOCALES export in
 * `src/i18n/index.tsx`; adding a new locale there is sufficient to surface it
 * here automatically.
 */
import React from "react";
import { useTranslation, SUPPORTED_LOCALES, type LocaleCode } from "../i18n";

export default function LanguageSwitcher() {
  const { locale, setLocale } = useTranslation();

  if (SUPPORTED_LOCALES.length <= 1) {
    // Don't render a switcher when only one locale is registered.
    return null;
  }

  return (
    <select
      data-testid="language-switcher"
      aria-label="Select language"
      value={locale}
      onChange={(e) => setLocale(e.target.value as LocaleCode)}
      className="language-switcher"
    >
      {SUPPORTED_LOCALES.map(({ code, label }) => (
        <option key={code} value={code}>
          {label}
        </option>
      ))}
    </select>
  );
}
