export type LandingLocale = 'zh-CN' | 'en';

export const LANDING_LOCALE_STORAGE_KEY = 'posterize-landing-locale';

const normalizeLocale = (value: string | null | undefined): LandingLocale | null => {
  if (!value) return null;
  const lowered = value.toLowerCase();
  if (lowered === 'zh' || lowered === 'zh-cn' || lowered === 'zh-hans') return 'zh-CN';
  if (lowered === 'en' || lowered === 'en-us' || lowered === 'en-gb') return 'en';
  return null;
};

export const resolveLandingLocale = (
  search: string,
  storedLocale?: string | null,
  browserLocale?: string | null
): LandingLocale => {
  const params = new URLSearchParams(search);
  const fromQuery = normalizeLocale(params.get('lang'));
  if (fromQuery) return fromQuery;

  const fromStorage = normalizeLocale(storedLocale);
  if (fromStorage) return fromStorage;

  const fromBrowser = normalizeLocale(browserLocale);
  if (fromBrowser) return fromBrowser;

  return 'zh-CN';
};

export const getLandingLocaleFromWindow = (): LandingLocale => {
  if (typeof window === 'undefined') return 'zh-CN';
  return resolveLandingLocale(
    window.location.search,
    window.localStorage.getItem(LANDING_LOCALE_STORAGE_KEY),
    window.navigator.language
  );
};

export const persistLandingLocale = (locale: LandingLocale) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LANDING_LOCALE_STORAGE_KEY, locale);
};
