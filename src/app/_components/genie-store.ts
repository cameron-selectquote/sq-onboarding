'use client';

/**
 * In-memory Genie conversation store, shared across every mounted GenieChat
 * (the global overlay launcher and the standalone /specialist/genie page).
 *
 * Why module-level state and not sessionStorage: the ask is "don't restart the
 * chat unless the browser refreshes". Module state lives for the life of the
 * JS bundle — it survives client-side route navigation (the module isn't re-
 * evaluated) but is wiped on a full page reload, which is exactly the desired
 * behavior. sessionStorage would wrongly survive a refresh.
 *
 * Components subscribe to changes; any update re-renders all listeners so the
 * overlay and the page view stay in lock-step.
 */

/** A structured card the chat renders alongside a message (render-only). */
export type GenieStoredCard = unknown;

export interface StoredTurn {
  role: 'genie' | 'user';
  text: string;
  engine?: 'strands-bedrock' | 'scripted';
  card?: GenieStoredCard | null;
}

export interface GenieState {
  /** Whether the opening greeting has been fetched yet. */
  started: boolean;
  turns: StoredTurn[];
  confirmedCandidateId: string | null;
  plan: unknown;
  offboard: unknown;
  templateDraft: unknown;
  engine: 'strands-bedrock' | 'scripted' | null;
}

function initialState(): GenieState {
  return {
    started: false,
    turns: [],
    confirmedCandidateId: null,
    plan: null,
    offboard: null,
    templateDraft: null,
    engine: null,
  };
}

let state: GenieState = initialState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function getGenieState(): GenieState {
  return state;
}

export function setGenieState(
  update: Partial<GenieState> | ((prev: GenieState) => Partial<GenieState>),
): void {
  const patch = typeof update === 'function' ? update(state) : update;
  state = {...state, ...patch};
  emit();
}

export function subscribeGenie(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reset the whole conversation (used by a "new chat" control). */
export function resetGenie(): void {
  state = initialState();
  emit();
}
