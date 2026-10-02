import { saveDraft } from './drafts';
import { VoiceMode, VoiceSessionOut } from './types';

/**
 * Note a freshly read capture as an unfinished bill the moment it comes back.
 *
 * Reading a recording or a photo takes a few seconds, and a shopkeeper often walks away from the
 * screen meanwhile to serve someone. If they are no longer there when the result arrives, the app must
 * not yank them back to it; it puts the bill on Home as "not saved yet" instead, ready when they are.
 */
export function registerCapture(session: VoiceSessionOut, mode: VoiceMode, source: 'voice' | 'photo'): void {
  if (session.status === 'failed' || session.status === 'no_speech' || session.status === 'no_text') return;
  const items = session.extraction?.items ?? [];
  const names = items.map((i) => i.product_name_guess).filter(Boolean);
  saveDraft({
    key: session.session_id,
    route: `/review/${session.session_id}`,
    mode,
    source,
    items: items.length,
    total: 0,
    preview: names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : ''),
    updatedAt: Date.now(),
  });
}
