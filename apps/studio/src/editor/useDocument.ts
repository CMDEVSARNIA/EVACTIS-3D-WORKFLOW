import { useSyncExternalStore } from 'react';
import type { DocumentState, DocumentStore } from './store.ts';

/** Re-renders on every document change (edit, undo, save status). */
export function useDocument(store: DocumentStore): DocumentState {
  return useSyncExternalStore(store.subscribe, store.getState);
}

/** Text of an edit refused because something still uses what was removed. */
export function refusal(e: unknown): string {
  if (e && typeof e === 'object' && 'uses' in e && Array.isArray((e as { uses: unknown }).uses))
    return (e as { uses: string[] }).uses.join('; ');
  return e instanceof Error ? e.message : String(e);
}
