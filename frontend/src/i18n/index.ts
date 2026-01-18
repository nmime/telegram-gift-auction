import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './en.json';
import ru from './ru.json';

const LANGUAGE_KEY = 'user_language';

export function mapToSupportedLanguage(langCode: string | undefined): string {
  if (!langCode) return 'en';
  return ['ru', 'uk', 'be'].includes(langCode) ? 'ru' : 'en';
}

function detectLanguage(): string {
  const storedLang = localStorage.getItem(LANGUAGE_KEY);
  if (storedLang && ['en', 'ru'].includes(storedLang)) {
    return storedLang;
  }

  const tgLang = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
  if (tgLang) {
    return mapToSupportedLanguage(tgLang);
  }

  const browserLang = navigator.language?.split('-')[0];
  if (browserLang) {
    return mapToSupportedLanguage(browserLang);
  }

  return 'en';
}

export function saveLanguagePreference(lang: string): void {
  localStorage.setItem(LANGUAGE_KEY, lang);
}

export function changeLanguage(lang: string): void {
  const supportedLang = ['en', 'ru'].includes(lang) ? lang : 'en';
  saveLanguagePreference(supportedLang);
  i18n.changeLanguage(supportedLang);
}

export function getCurrentLanguage(): string {
  return i18n.language || 'en';
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ru: { translation: ru },
    },
    lng: detectLanguage(),
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
