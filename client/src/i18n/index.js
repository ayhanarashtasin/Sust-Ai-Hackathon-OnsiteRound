import { createContext, useContext } from 'react';
import en from './en.js';
import bn from './bn.js';
import banglish from './banglish.js';

export const LANGS = { en, bn, banglish };
export const LangContext = createContext({ lang: 'en', t: en, setLang: () => {} });
export const useLang = () => useContext(LangContext);

/* Pick the right alert message field for the active language */
export function alertMessage(alert, lang) {
  if (lang === 'bn') return alert.message_bn || alert.message_en;
  if (lang === 'banglish') return alert.message_banglish || alert.message_en;
  return alert.message_en;
}
export function alertTitle(alert, lang) {
  return lang === 'bn' ? alert.title_bn || alert.title_en : alert.title_en;
}
export function alertNextStep(alert, lang) {
  return lang === 'bn' ? alert.recommendedNextStep_bn || alert.recommendedNextStep_en : alert.recommendedNextStep_en;
}
