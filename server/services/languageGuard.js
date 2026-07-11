/*
  Careful-language runtime guard (enforces AC-4).
  EVERY alert message — OpenAI-generated OR template — passes through here
  before save/display. OpenAI output is non-deterministic; the system prompt
  alone is not enforcement. Banned words => reject (caller falls back to the
  safe template, which is itself guard-checked at test time).
*/
const BANNED = [
  'fraud', 'fraudulent', 'fraudster', 'criminal', 'crime', 'guilty', 'thief', 'theft',
  'stole', 'stolen', 'scam', 'scammer', 'launder', 'laundering', 'accused', 'accusation',
  'illegal', 'culprit',
  // Bangla equivalents
  'জালিয়াতি', 'প্রতারণা', 'প্রতারক', 'অপরাধী', 'অপরাধ', 'চোর', 'চুরি', 'দোষী', 'অবৈধ',
];

export function findBannedLanguage(text) {
  if (!text) return [];
  const lower = String(text).toLowerCase();
  return BANNED.filter((w) => lower.includes(w.toLowerCase()));
}

export function isSafeLanguage(text) {
  return findBannedLanguage(text).length === 0;
}

/* Returns text if safe, otherwise null (caller must fall back to template). */
export function assertSafeLanguage(text) {
  return isSafeLanguage(text) ? text : null;
}
