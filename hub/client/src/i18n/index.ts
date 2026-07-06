import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { en, type TranslationKey } from './en';
import { th } from './th';

export type Locale = 'en' | 'th';

const locales: Record<Locale, Record<TranslationKey, string>> = { en, th };

/**
 * First-run locale: follow the browser language when it is Thai, else English.
 * Only used when nothing is persisted yet — the persist middleware rehydrates
 * the user's explicit choice on subsequent visits.
 */
function detectLocale(): Locale {
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('th')) {
    return 'th';
  }
  return 'en';
}

interface I18nStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useI18nStore = create<I18nStore>()(
  persist(
    (set) => ({
      locale: detectLocale(),
      setLocale: (locale) => set({ locale }),
    }),
    { name: 'hub-locale' },
  ),
);

/**
 * Translation hook. Returns a function `t(key)` that resolves to the current locale's string.
 *
 * Usage:
 * ```tsx
 * const t = useT();
 * <Text>{t('nav.dashboard')}</Text>
 * ```
 */
export function useT(): (key: TranslationKey) => string {
  const locale = useI18nStore((s) => s.locale);
  return (key: TranslationKey) => locales[locale][key] ?? en[key] ?? key;
}

export type { TranslationKey };
