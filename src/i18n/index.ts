import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import da from './locales/da.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      da: { translation: da },
    },
    // Danish is the default (issue #119): the first entry is the language used
    // when the browser's language is neither en nor da. LanguageDetector still
    // browser-matches en/da below; 'en' stays in the chain as a secondary
    // fallback for any key ever missing in da.
    fallbackLng: ['da', 'en'],
    supportedLngs: ['en', 'da'],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'preferred_language',
    },
  });

// Keep the document's lang attribute in sync with the language actually shown
// (#189): screen readers and browser "translate page" read it. Use
// resolvedLanguage, not the raw detected code — an unsupported browser language
// renders the Danish fallback, so the document should declare 'da'.
const syncDocumentLang = () => {
  document.documentElement.lang = i18n.resolvedLanguage ?? 'da';
};
i18n.on('initialized', syncDocumentLang);
i18n.on('languageChanged', syncDocumentLang);

export default i18n;
