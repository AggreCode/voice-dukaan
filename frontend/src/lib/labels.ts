import { useEffect, useState } from 'react';
import { auth } from './auth';

/**
 * A second line, in the shop's own language, under the words that matter most.
 *
 * Not a full translation of the app. The big choices -- sell or buy, speak, photograph or type, stock,
 * report -- carry the word a shopkeeper would say out loud, so someone who reads Odia or Hindi far more
 * easily than English recognises the button instead of decoding it. Everything else stays in English,
 * where a wrong translation would do more harm than an untranslated word.
 *
 * Wording to check or change lives here and nowhere else.
 */
export type Lang = 'en' | 'hi' | 'or';

export function langFromCode(code: string | null | undefined): Lang {
  const c = (code ?? '').toLowerCase();
  if (c.startsWith('or') || c.startsWith('od')) return 'or';
  if (c.startsWith('hi')) return 'hi';
  return 'en';
}

const WORDS = {
  sell: { hi: 'बेचें', or: 'ବିକ୍ରି' },
  buy: { hi: 'खरीदें', or: 'କିଣା' },
  sellHint: { hi: 'ग्राहक का बिल बनाएँ', or: 'ଗ୍ରାହକଙ୍କ ପାଇଁ ବିଲ୍' },
  buyHint: { hi: 'माल आया', or: 'ମାଲ ଆସିଲା' },
  speak: { hi: 'बोलकर', or: 'କହି' },
  photo: { hi: 'फ़ोटो से', or: 'ଫଟୋରୁ' },
  type: { hi: 'लिखकर', or: 'ଲେଖି' },
  stock: { hi: 'मेरा माल', or: 'ମୋ ମାଲ' },
  report: { hi: 'हिसाब', or: 'ହିସାବ' },
  home: { hi: 'होम', or: 'ଘର' },
  more: { hi: 'और', or: 'ଅଧିକ' },
  back: { hi: 'पीछे', or: 'ପଛକୁ' },
  bills: { hi: 'बिल', or: 'ବିଲ୍' },
  hello: { hi: 'नमस्ते', or: 'ନମସ୍କାର' },
  save: { hi: 'सेव करें', or: 'ସେଭ୍ କରନ୍ତୁ' },
} as const;

export type WordKey = keyof typeof WORDS;

export function local(key: WordKey, lang: Lang): string | null {
  if (lang === 'en') return null;
  return WORDS[key][lang];
}

/** The shop's language, following sign-in and sign-out. */
export function useLang(): Lang {
  const [lang, setLang] = useState<Lang>(() => langFromCode(auth.getLanguage()));
  useEffect(() => {
    const h = () => setLang(langFromCode(auth.getLanguage()));
    window.addEventListener('vd:auth', h);
    return () => window.removeEventListener('vd:auth', h);
  }, []);
  return lang;
}

/** `local()` bound to the current shop's language. */
export function useLocal(): (key: WordKey) => string | null {
  const lang = useLang();
  return (key) => local(key, lang);
}
