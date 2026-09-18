import { uuidv7 } from 'uuidv7';

/**
 * Every entity id in RewardBite is server-generated UUID v7 (time-ordered,
 * index-friendly) — architecture section 11: "the browser never mints
 * entity ids." This is the single call site every repository/service uses.
 */
export function newId(): string {
  return uuidv7();
}
