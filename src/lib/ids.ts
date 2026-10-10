/**
 * Id + clock helpers.
 *
 * Centralizing these keeps the domain logic deterministic under test: a test
 * can inject a fixed id/clock instead of relying on random UUIDs or the wall
 * clock. Production callers use the defaults.
 */

export type IdGenerator = () => string;
export type Clock = () => Date;

/** Default id generator — prefers crypto.randomUUID when available. */
export const defaultIdGenerator: IdGenerator = () => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID.
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

/** Default clock — the real wall clock. */
export const defaultClock: Clock = () => new Date();

/** Returns a sequential id generator, handy for deterministic tests. */
export function sequentialIdGenerator(prefix = "id"): IdGenerator {
  let n = 0;
  return () => `${prefix}_${++n}`;
}

/** Returns a frozen clock at a fixed instant, handy for deterministic tests. */
export function fixedClock(iso: string): Clock {
  const date = new Date(iso);
  return () => new Date(date);
}
