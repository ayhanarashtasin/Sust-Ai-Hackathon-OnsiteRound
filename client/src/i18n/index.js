import { createContext, useContext } from 'react';
import en from './en.js';
import bn from './bn.js';
import banglish from './banglish.js';

export const LANGS = { en, bn, banglish };
export const LangContext = createContext({ lang: 'en', t: en, setLang: () => {} });
export const useLang = () => useContext(LangContext);

/* Pick the right alert field for the active language — every field is trilingual. */
export function alertMessage(alert, lang) {
  if (lang === 'bn') return alert.message_bn || alert.message_en;
  if (lang === 'banglish') return alert.message_banglish || alert.message_en;
  return alert.message_en;
}
export function alertTitle(alert, lang) {
  if (lang === 'bn') return alert.title_bn || alert.title_en;
  if (lang === 'banglish') return alert.title_banglish || alert.title_en;
  return alert.title_en;
}
export function alertNextStep(alert, lang) {
  if (lang === 'bn') return alert.recommendedNextStep_bn || alert.recommendedNextStep_en;
  if (lang === 'banglish') return alert.recommendedNextStep_banglish || alert.recommendedNextStep_en;
  return alert.recommendedNextStep_en;
}

/* Translated labels for enum-ish values (statuses, roles, alert kinds). */
export const statusLabel = (t, s) => t[`st_${s}`] || s;
export const roleLabel = (t, r) => t[`role_${r}`] || r;
export const kindLabel = (t, k) => t[`kind_${k}`] || k;
export const issueLabel = (t, i) => t[`issue_${i}`] || i;
