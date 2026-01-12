import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './en.json';
import ru from './ru.json';

// Detect language from Telegram WebApp or browser
function detectLanguage(): string {
  // First, try Telegram WebApp
  const tgLang = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
  if (tgLang) {
    // Map Ukrainian and Belarusian to Russian
    return ['ru', 'uk', 'be'].includes(tgLang) ? 'ru' : 'en';
  }

  // Fall back to browser language
  const browserLang = navigator.language?.split('-')[0];
  if (browserLang) {
    return ['ru', 'uk', 'be'].includes(browserLang) ? 'ru' : 'en';
  }

  return 'en';
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
