/* FNV-1a + murmur3 finalizer: full avalanche, so ids that differ by ONE
 * character (cards created in sequence share everything but the trailing
 * counter) still land on completely unrelated values. The simple
 * multiply-add hash used before barely mixed, so a row of cards made
 * together got near-identical pin hues. */
function hash32(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/* Deterministic per-id rotation for the corkboard feel. Same id -> same
 * tilt across renders and reloads. Uniform over the nine half-degree
 * steps from -2 to +2 (including 0), so a board reads like it was pinned
 * by a human: most cards cant a little, some sit dead straight, a few
 * lean hard. (Different hash bits than pinColor's hue, so a card's tilt
 * and pin color don't visibly correlate.) */
export function tilt(id: string): number {
  return ((hash32(id) >>> 7) % 9) * 0.5 - 2;
}

/* Deterministic per-id pushpin color (for the "random" pin option) -- a full
 * hue spread with a little saturation/lightness jitter so neighbors read as
 * different pins from a real box. Same id -> same color. Returned as an
 * hsl() string; the pin gradient derives highlight/shadow. */
export function pinColor(id: string): string {
  const h = hash32(id);
  const hue = h % 360;
  const sat = 56 + ((h >>> 9) % 13); // 56-68%
  const light = 48 + ((h >>> 17) % 12); // 48-59%
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}
