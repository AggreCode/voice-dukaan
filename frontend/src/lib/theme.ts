import { VoiceMode } from './types';

/**
 * Selling is green, buying is blue, on every screen of each.
 *
 * A shopkeeper who glances at the phone mid-conversation should know which side of the counter the
 * screen is on without reading a word: green means money is coming in from a customer, blue means
 * stock is coming in from a wholesaler. The colour is the signpost; the words only confirm it.
 *
 * Tailwind only ships classes it can see written out in full, so every class is spelled out here.
 */
export interface ModeTheme {
  solid: string;
  solidActive: string;
  gradient: string;
  soft: string;
  softBorder: string;
  text: string;
  textDark: string;
  ring: string;
  chip: string;
  dot: string;
}

export const THEME: Record<VoiceMode, ModeTheme> = {
  sale: {
    solid: 'bg-emerald-600 text-white',
    solidActive: 'active:bg-emerald-700',
    gradient: 'bg-gradient-to-br from-emerald-500 to-emerald-700 text-white',
    soft: 'bg-emerald-50',
    softBorder: 'border-emerald-200',
    text: 'text-emerald-700',
    textDark: 'text-emerald-900',
    ring: 'focus:ring-emerald-300',
    chip: 'bg-emerald-100 text-emerald-800',
    dot: 'bg-emerald-500',
  },
  stock_in: {
    solid: 'bg-blue-600 text-white',
    solidActive: 'active:bg-blue-700',
    gradient: 'bg-gradient-to-br from-blue-500 to-blue-700 text-white',
    soft: 'bg-blue-50',
    softBorder: 'border-blue-200',
    text: 'text-blue-700',
    textDark: 'text-blue-900',
    ring: 'focus:ring-blue-300',
    chip: 'bg-blue-100 text-blue-800',
    dot: 'bg-blue-500',
  },
};

/** The URL segment for each side of the counter. */
export const SIDE: Record<VoiceMode, 'sell' | 'buy'> = { sale: 'sell', stock_in: 'buy' };

export function modeFromSide(side: string | undefined): VoiceMode {
  return side === 'buy' ? 'stock_in' : 'sale';
}
