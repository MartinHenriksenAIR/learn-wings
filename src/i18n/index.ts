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
    // English is the catch-all default (issue #226, overriding #119): when the
    // browser's language is neither en nor da, i18next renders English — not
    // Danish. LanguageDetector still browser-matches en/da below, so a Danish
    // browser resolves to 'da' and an English browser to 'en'; only unrecognized
    // languages hit this fallback. 'en' also stays the secondary key fallback
    // for any key ever missing in da.
    fallbackLng: 'en',
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
// renders the English fallback (#226), so the document should declare 'en'.
const syncDocumentLang = () => {
  document.documentElement.lang = i18n.resolvedLanguage ?? 'en';
};
i18n.on('initialized', syncDocumentLang);
i18n.on('languageChanged', syncDocumentLang);

export default i18n;
