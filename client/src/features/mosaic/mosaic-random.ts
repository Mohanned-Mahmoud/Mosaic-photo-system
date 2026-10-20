/**
 * Deterministic PRNG and Shuffled Permutation for Random Tile/Letter Placements.
 * Guarantees that photos are placed in non-sequential (random) spots across the
 * mosaic board, while remaining 100% stable across re-renders.
 */

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return hash;
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Returns a stable shuffled array of numbers 0 .. (totalCount - 1).
 * The order is determined by seedKey (e.g. eventId or restartKey).
 */
export function getShuffledIndices(
  totalCount: number,
  seedKey: string | number = "mosaic-random-seed"
): number[] {
  if (totalCount <= 1) return Array.from({ length: Math.max(0, totalCount) }, (_, i) => i);

  const seed = typeof seedKey === "number" ? seedKey : hashString(String(seedKey));
  const rand = mulberry32(seed || 1234567);

  const array = Array.from({ length: totalCount }, (_, i) => i);
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
  return array;
}

/**
 * Given a shuffled permutation where photo `p` is placed in slot `shuffled[p]`,
 * returns an array mapping `slotIndex -> photoIndex` (or -1 if slot is unoccupied).
 */
export function createSlotToPhotoMap(
  totalSlots: number,
  photosCount: number,
  seedKey: string | number = "mosaic-random-seed"
): Int32Array {
  const map = new Int32Array(totalSlots).fill(-1);
  if (totalSlots <= 0 || photosCount <= 0) return map;

  const shuffled = getShuffledIndices(totalSlots, seedKey);
  const fillCount = Math.min(totalSlots, photosCount);

  for (let p = 0; p < fillCount; p++) {
    const slot = shuffled[p];
    if (slot >= 0 && slot < totalSlots) {
      map[slot] = p;
    }
  }
  return map;
}
