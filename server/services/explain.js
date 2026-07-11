import { assertSafeLanguage } from './languageGuard.js';

/*
  Explanation layer (AC-7):
    structured evidence ──▶ OpenAI (if key present, 4s timeout, guard-checked)
                       └──▶ deterministic bn/en/Banglish templates (fallback — demo never breaks)
  Every path is wrapped by the careful-language guard. Advisory tone only.
  EVERY subtype is fully trilingual: title, message, and next step in en/bn/banglish.
*/

function fmtTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function taka(n) {
  return `৳${Number(n || 0).toLocaleString('en-IN')}`;
}

const resourceName = { en: (f) => (f.resource === 'cash' ? 'physical cash' : `${f.provider} e-money`), bn: (f) => (f.resource === 'cash' ? 'নগদ টাকা' : `${f.provider} ই-মানি`) };

/* ---------- Templates (safe by construction, unit-tested against the guard) ---------- */
export function templateExplanation(finding) {
  const e = finding.evidence || {};
  switch (finding.subtype) {
    case 'cash_depletion':
    case 'emoney_depletion': {
      const res_en = resourceName.en(e);
      const res_bn = resourceName.bn(e);
      const t = fmtTime(e.projectedDepletionAt);
      const topup = e.suggestedTopUp > 0 ? e.suggestedTopUp : null;
      const suppressed = e.recommendationSuppressed;
      return {
        title_en: `${res_en} may run out around ${t}`,
        title_bn: `${res_bn} আনুমানিক ${t} এর মধ্যে শেষ হয়ে যেতে পারে`,
        title_banglish: `${res_en} approx ${t} er moddhe shesh hoye jete pare`,
        message_en: `Based on the current transaction trend (burn ~${taka(e.burnRatePerMin)}/min over the last ${e.windowMin} min), ${res_en} may fall below the safe level around ${t}. Confidence: ${Math.round((finding.confidence || 0) * 100)}%.`,
        message_bn: `বর্তমান লেনদেনের ধারা অনুযায়ী (গত ${e.windowMin} মিনিটে ~${taka(e.burnRatePerMin)}/মিনিট), ${res_bn} আনুমানিক ${t} এর মধ্যে নিরাপদ সীমার নিচে নেমে যেতে পারে। আস্থা: ${Math.round((finding.confidence || 0) * 100)}%।`,
        message_banglish: `Current lenden trend onujayi, apnar ${res_en} approx ${t} er moddhe shesh hoye jete pare. Confidence: ${Math.round((finding.confidence || 0) * 100)}%.`,
        recommendedNextStep_en: suppressed
          ? `A data problem affects this feed, so no top-up amount is recommended right now. Verify the feed first, then re-check the forecast.`
          : topup
            ? `To continue serving safely, consider arranging at least ${taka(topup)} additional ${e.resource === 'cash' ? 'cash' : 'e-money float via an authorized top-up request'}.`
            : `Monitor closely; current headroom may be sufficient for now.`,
        recommendedNextStep_bn: suppressed
          ? `এই ফিডে ডেটা সমস্যা থাকায় এখন কোনো টপ-আপ পরিমাণের পরামর্শ দেওয়া হচ্ছে না। আগে ফিড যাচাই করুন, তারপর পূর্বাভাস আবার দেখুন।`
          : topup
            ? `নিরাপদভাবে সেবা চালু রাখতে কমপক্ষে ${taka(topup)} অতিরিক্ত ${e.resource === 'cash' ? 'নগদ' : 'ই-মানি (অনুমোদিত টপ-আপ অনুরোধের মাধ্যমে)'} ব্যবস্থা করার পরামর্শ দেওয়া হচ্ছে।`
            : `পরিস্থিতি পর্যবেক্ষণ করুন; আপাতত বর্তমান ব্যালেন্স যথেষ্ট হতে পারে।`,
        recommendedNextStep_banglish: suppressed
          ? `Ei feed e data problem ache, tai ekhon kono top-up amount recommend kora hocche na. Age feed verify korun, pore forecast abar dekhun.`
          : topup
            ? `Nirapode service chalu rakhte komapokkhe ${taka(topup)} extra ${e.resource === 'cash' ? 'cash' : 'e-money float (authorized top-up request er maddhome)'} bebostha korar poramorsho deya hocche.`
            : `Poristhiti monitor korun; apatoto current balance jotheshto hote pare.`,
      };
    }
    case 'velocity_spike':
      return {
        title_en: `Unusually high ${e.provider} cash-out volume — requires review`,
        title_bn: `${e.provider}-এ অস্বাভাবিক বেশি ক্যাশ-আউট — পর্যালোচনা প্রয়োজন`,
        title_banglish: `${e.provider}-e unusual beshi cash-out — review dorkar`,
        message_en: `In the last ${e.bucketMinutes} minutes there were ${e.bucketCount} cash-outs vs a typical ${e.baselineMean} (z-score ${e.zScore}), concentrated in ${e.distinctAccounts} account(s). This may be normal pre-Eid demand, but it is unusual against the baseline.`,
        message_bn: `গত ${e.bucketMinutes} মিনিটে ${e.bucketCount}টি ক্যাশ-আউট হয়েছে, যেখানে স্বাভাবিক গড় ${e.baselineMean} (z-স্কোর ${e.zScore}), এবং বেশিরভাগ মাত্র ${e.distinctAccounts}টি অ্যাকাউন্ট থেকে। এটি ঈদ-পূর্ব স্বাভাবিক চাহিদাও হতে পারে, তবে ধারার তুলনায় অস্বাভাবিক।`,
        message_banglish: `Gato ${e.bucketMinutes} minute e ${e.bucketCount} ta cash-out hoyeche, normal average ${e.baselineMean}, ar beshirbhag matro ${e.distinctAccounts} ta account theke. Eta Eid demand hote pare, kintu baseline er tulonay unusual.`,
        recommendedNextStep_en: `Review the flagged transactions before arranging a large cash top-up. Human review required — this is not a determination.`,
        recommendedNextStep_bn: `বড় অঙ্কের নগদ পুনরায় সরবরাহের আগে চিহ্নিত লেনদেনগুলো পর্যালোচনা করা প্রয়োজন। এটি কোনো চূড়ান্ত সিদ্ধান্ত নয়।`,
        recommendedNextStep_banglish: `Boro amount er cash refill er age flagged lenden gulo review kora dorkar. Human review lagbe — eta final decision na.`,
      };
    case 'demand_surge':
      return {
        title_en: `High ${e.provider} demand — consistent with a normal rush`,
        title_bn: `${e.provider}-এ চাহিদা বেশি — স্বাভাবিক ভিড়ের সাথে সামঞ্জস্যপূর্ণ`,
        title_banglish: `${e.provider}-e demand beshi — normal rush er sathe consistent`,
        message_en: `Cash-out volume is well above baseline (${e.bucketCount} in ${e.bucketMinutes} min vs typical ${e.baselineMean}), but it comes from ${e.distinctAccounts} different accounts with varied amounts — the shape of ordinary busy-day demand, not a concentrated pattern.`,
        message_bn: `ক্যাশ-আউটের পরিমাণ স্বাভাবিকের চেয়ে বেশি (${e.bucketMinutes} মিনিটে ${e.bucketCount}টি, স্বাভাবিক গড় ${e.baselineMean}), তবে এগুলো ${e.distinctAccounts}টি ভিন্ন অ্যাকাউন্ট থেকে বিভিন্ন পরিমাণে এসেছে — এটি সাধারণ ব্যস্ত দিনের চাহিদার ধরন।`,
        message_banglish: `Cash-out volume baseline er cheye beshi (${e.bucketMinutes} minute e ${e.bucketCount} ta, normal ${e.baselineMean}), kintu egulo ${e.distinctAccounts} ta different account theke different amount e — eta ordinary busy-day demand er dhoron.`,
        recommendedNextStep_en: `No review needed. Watch the liquidity forecast — high demand drains float faster than usual.`,
        recommendedNextStep_bn: `পর্যালোচনার প্রয়োজন নেই। লিকুইডিটি পূর্বাভাসে নজর রাখুন — বেশি চাহিদায় ব্যালেন্স দ্রুত কমে।`,
        recommendedNextStep_banglish: `Review lagbe na. Liquidity forecast e nojor rakhun — beshi demand e balance druto kome.`,
      };
    case 'repeated_amount':
      return {
        title_en: `Repeated near-identical ${e.provider} cash-outs — requires review`,
        title_bn: `${e.provider}-এ প্রায় একই পরিমাণের বারবার ক্যাশ-আউট — পর্যালোচনা প্রয়োজন`,
        title_banglish: `${e.provider}-e proyay ek e amount er barbar cash-out — review dorkar`,
        message_en: `${e.repeatCount} cash-outs of ~${taka(e.amount)} came from only ${e.distinctAccounts} account(s) within ${e.windowMinutes} minutes. This pattern is unusual and requires review; it may still have a normal explanation.`,
        message_bn: `${e.windowMinutes} মিনিটের মধ্যে মাত্র ${e.distinctAccounts}টি অ্যাকাউন্ট থেকে ~${taka(e.amount)} পরিমাণের ${e.repeatCount}টি ক্যাশ-আউট হয়েছে। এই ধরনটি অস্বাভাবিক এবং পর্যালোচনা প্রয়োজন; তবে স্বাভাবিক ব্যাখ্যাও থাকতে পারে।`,
        message_banglish: `${e.windowMinutes} minute er moddhe matro ${e.distinctAccounts} ta account theke ~${taka(e.amount)} er ${e.repeatCount} ta cash-out hoyeche. Pattern ta unusual, review dorkar.`,
        recommendedNextStep_en: `Review the listed transactions with the field officer before any large cash replenishment.`,
        recommendedNextStep_bn: `বড় অঙ্কের নগদ সরবরাহের আগে তালিকাভুক্ত লেনদেনগুলো ফিল্ড অফিসারের সাথে পর্যালোচনা করুন।`,
        recommendedNextStep_banglish: `Boro amount er cash refill er age listed lenden gulo field officer er sathe review korun.`,
      };
    case 'stale_feed':
      return {
        title_en: `${e.provider} data feed is delayed — reduced confidence`,
        title_bn: `${e.provider}-এর ডেটা ফিড বিলম্বিত — আস্থা কমানো হয়েছে`,
        title_banglish: `${e.provider} er data feed deri hocche — confidence komano hoyeche`,
        message_en: `No ${e.provider} data received for ${e.ageMinutes} minutes (threshold ${e.thresholdMinutes}). Forecasts for this provider are shown with reduced confidence and their top-up recommendations are withheld. Provider balances remain separate.`,
        message_bn: `${e.ageMinutes} মিনিট ধরে ${e.provider}-এর কোনো ডেটা আসেনি (সীমা ${e.thresholdMinutes} মিনিট)। এই প্রোভাইডারের পূর্বাভাস কম আস্থাসহ দেখানো হচ্ছে এবং টপ-আপ পরামর্শ স্থগিত রাখা হয়েছে।`,
        message_banglish: `${e.ageMinutes} minute dhore ${e.provider} er kono data ashe nai. Ei provider er forecast kom confidence e dekhano hocche, ar top-up recommendation atkano hoyeche.`,
        recommendedNextStep_en: `Avoid acting on ${e.provider} figures until the feed recovers. No recommendation is issued from this feed.`,
        recommendedNextStep_bn: `ফিড স্বাভাবিক না হওয়া পর্যন্ত ${e.provider}-এর তথ্যের ভিত্তিতে সিদ্ধান্ত নেওয়া থেকে বিরত থাকুন।`,
        recommendedNextStep_banglish: `Feed thik na howa porjonto ${e.provider} er figure er upor bhorosha kore kono step neben na.`,
      };
    case 'missing_feed':
      return {
        title_en: `No ${e.provider} feed data available — treat figures as untrusted`,
        title_bn: `${e.provider}-এর কোনো ফিড ডেটা নেই — তথ্য অবিশ্বস্ত হিসেবে বিবেচনা করুন`,
        title_banglish: `${e.provider} er kono feed data nai — figure untrusted dhore nin`,
        message_en: `The console has never received a feed timestamp for ${e.provider}. Its balance and forecast cannot be verified, so confidence is reduced and no recommendation is issued for this provider.`,
        message_bn: `${e.provider}-এর জন্য কোনো ফিড টাইমস্ট্যাম্প পাওয়া যায়নি। এর ব্যালেন্স ও পূর্বাভাস যাচাই করা যাচ্ছে না, তাই আস্থা কমানো হয়েছে এবং কোনো পরামর্শ দেওয়া হচ্ছে না।`,
        message_banglish: `${e.provider} er jonno kono feed timestamp pawa jay nai. Er balance ar forecast verify kora jacche na, tai confidence komano hoyeche ar kono recommendation deya hocche na.`,
        recommendedNextStep_en: `Contact the provider's operations team to restore the data feed before relying on ${e.provider} figures.`,
        recommendedNextStep_bn: `${e.provider}-এর তথ্যের ওপর নির্ভর করার আগে ডেটা ফিড পুনরুদ্ধারে প্রোভাইডারের অপারেশনস টিমের সাথে যোগাযোগ করুন।`,
        recommendedNextStep_banglish: `${e.provider} er figure er upor nirbhor korar age data feed thik korte provider er operations team er sathe jogajog korun.`,
      };
    case 'balance_mismatch':
      return {
        title_en: `${e.provider} balance does not reconcile — data problem likely`,
        title_bn: `${e.provider}-এর ব্যালেন্স মিলছে না — ডেটা সমস্যা হতে পারে`,
        title_banglish: `${e.provider} er balance milche na — data problem hote pare`,
        message_en: `Expected ${taka(e.expected)} from opening balance + transactions, but the feed reports ${taka(e.actual)} (difference ${taka(e.deltaAbs)}). This looks like a data-quality problem, not a conclusion about behavior.`,
        message_bn: `শুরুর ব্যালেন্স ও লেনদেন অনুযায়ী প্রত্যাশিত ${taka(e.expected)}, কিন্তু ফিডে দেখাচ্ছে ${taka(e.actual)} (পার্থক্য ${taka(e.deltaAbs)})। এটি সম্ভবত ডেটা-মানের সমস্যা।`,
        message_banglish: `Expected ${taka(e.expected)} kintu feed e ${taka(e.actual)} dekhacche (difference ${taka(e.deltaAbs)}). Eta data-quality problem hote pare.`,
        recommendedNextStep_en: `Verify with the provider's operations team before relying on this balance. Confidence reduced until reconciled.`,
        recommendedNextStep_bn: `এই ব্যালেন্সের ওপর নির্ভর করার আগে প্রোভাইডারের অপারেশনস টিমের সাথে যাচাই করুন।`,
        recommendedNextStep_banglish: `Ei balance er upor nirbhor korar age provider er operations team er sathe verify korun.`,
      };
    default:
      return {
        title_en: 'Alert requires review', title_bn: 'পর্যালোচনা প্রয়োজন', title_banglish: 'Review dorkar',
        message_en: 'An unusual condition was detected and requires human review.',
        message_bn: 'একটি অস্বাভাবিক অবস্থা শনাক্ত হয়েছে এবং পর্যালোচনা প্রয়োজন।',
        message_banglish: 'Ekta unusual condition detect hoyeche, review dorkar.',
        recommendedNextStep_en: 'Review with the responsible team.',
        recommendedNextStep_bn: 'দায়িত্বপ্রাপ্ত টিমের সাথে পর্যালোচনা করুন।',
        recommendedNextStep_banglish: 'Responsible team er sathe review korun.',
      };
  }
}

/* ---------- OpenAI path (optional; template fallback on any failure) ---------- */
const SYSTEM_PROMPT = `You write short advisory alerts for mobile-financial-service agents in Bangladesh.
Rules (hard): use careful language ("unusual", "requires review") — NEVER the words fraud, criminal, guilty, accused or any accusation. Never claim certainty. Providers (bKash/Nagad/Rocket) are separate — never suggest transferring between them. Advisory only — a human decides. Output STRICT JSON: {"message_en":"...","message_bn":"...","message_banglish":"..."} (Banglish = Bengali in Latin script). Max 2 sentences each.`;

async function openaiExplanation(finding) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Alert type: ${finding.subtype}. Severity: ${finding.severity}. Confidence: ${finding.confidence}. Evidence: ${JSON.stringify(finding.evidence)}` },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    // Runtime guard on EVERY generated field — reject the whole result if any fails.
    if (!assertSafeLanguage(parsed.message_en) || !assertSafeLanguage(parsed.message_bn) || !assertSafeLanguage(parsed.message_banglish)) {
      console.warn('[explain] OpenAI output failed language guard — falling back to template');
      return null;
    }
    return parsed;
  } catch {
    return null; // timeout / network / parse — template fallback
  } finally {
    clearTimeout(timer);
  }
}

/* Public API: always returns a complete, guard-safe explanation + which path produced it. */
export async function generateExplanation(finding) {
  const template = templateExplanation(finding);
  const ai = await openaiExplanation(finding);
  if (ai) {
    return {
      ...template, // titles + next steps stay templated (deterministic, quantified)
      message_en: ai.message_en,
      message_bn: ai.message_bn,
      message_banglish: ai.message_banglish,
      explanationSource: 'openai',
    };
  }
  return { ...template, explanationSource: 'template' };
}
