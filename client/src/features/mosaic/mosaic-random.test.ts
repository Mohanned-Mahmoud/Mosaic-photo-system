import { describe, expect, it } from "vitest";
import { createSlotToPhotoMap, getShuffledIndices } from "./mosaic-random";

describe("Mosaic Random Placement", () => {
  it("produces deterministic permutation for the same seed", () => {
    const perm1 = getShuffledIndices(50, "watermark-grid-order");
    const perm2 = getShuffledIndices(50, "watermark-grid-order");
    expect(perm1).toEqual(perm2);
    expect(perm1).toHaveLength(50);
    // All indices 0..49 must be present
    const sorted = [...perm1].sort((a, b) => a - b);
    expect(sorted).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it("produces different permutations for different seeds", () => {
    const perm1 = getShuffledIndices(30, "watermark-grid-order");
    const perm2 = getShuffledIndices(30, "mask-solid-order");
    expect(perm1).not.toEqual(perm2);
  });

  it("never moves existing photos when a new photo arrives", () => {
    const totalSlots = 100;
    const mapWith1 = createSlotToPhotoMap(totalSlots, 1, "watermark-grid-order");
    const mapWith2 = createSlotToPhotoMap(totalSlots, 2, "watermark-grid-order");
    const mapWith3 = createSlotToPhotoMap(totalSlots, 3, "watermark-grid-order");

    // Slot that holds photo 0 in mapWith1
    const slotForPhoto0In1 = mapWith1.indexOf(0);
    const slotForPhoto0In2 = mapWith2.indexOf(0);
    const slotForPhoto0In3 = mapWith3.indexOf(0);

    expect(slotForPhoto0In1).toBeGreaterThanOrEqual(0);
    expect(slotForPhoto0In2).toBe(slotForPhoto0In1);
    expect(slotForPhoto0In3).toBe(slotForPhoto0In1);

    // Slot that holds photo 1 in mapWith2
    const slotForPhoto1In2 = mapWith2.indexOf(1);
    const slotForPhoto1In3 = mapWith3.indexOf(1);
    expect(slotForPhoto1In2).toBeGreaterThanOrEqual(0);
    expect(slotForPhoto1In3).toBe(slotForPhoto1In2);
    expect(slotForPhoto1In2).not.toBe(slotForPhoto0In1);
  });

  it("handles edge cases (0 slots, 0 photos, photos > slots)", () => {
    expect(createSlotToPhotoMap(0, 5, "seed")).toHaveLength(0);
    expect(createSlotToPhotoMap(10, 0, "seed")).toHaveLength(10);
    expect(createSlotToPhotoMap(10, 0, "seed").every((v) => v === -1)).toBe(true);

    const fullMap = createSlotToPhotoMap(5, 10, "seed");
    expect(fullMap).toHaveLength(5);
    expect(fullMap.every((v) => v >= 0 && v < 5)).toBe(true);
  });

  it("computes letter grid cells correctly for mode 4", async () => {
    const { getLetterGridCells } = await import("../booth/letters-mask");
    const mockLetters = Array.from({ length: 11 }, (_, i) => ({
      id: i + 1,
      x: i * 150,
      y: 700,
      w: 140,
      h: 170,
    }));

    const gridCells = getLetterGridCells(mockLetters, "grid");
    expect(gridCells).toHaveLength(99); // 11 * 9
    expect(gridCells[0].w).toBeCloseTo(140 / 3, 1);
    expect(gridCells[0].h).toBeCloseTo(170 / 3, 1);

    // Verify multiple stacked rows (rows 0, 1, 2)
    const letter0Rows = new Set(gridCells.filter((c) => c.letterIdx === 0).map((c) => c.row));
    expect(letter0Rows.size).toBe(3);
    expect(letter0Rows.has(0)).toBe(true);
    expect(letter0Rows.has(1)).toBe(true);
    expect(letter0Rows.has(2)).toBe(true);

    const denseCells = getLetterGridCells(mockLetters, "dense");
    expect(denseCells).toHaveLength(176); // 11 * 16
    const letter0DenseRows = new Set(denseCells.filter((c) => c.letterIdx === 0).map((c) => c.row));
    expect(letter0DenseRows.size).toBe(4);

    // Deterministic placement within letter grid
    const map = createSlotToPhotoMap(gridCells.length, 5, "letters-grid-random-order");
    expect(map).toHaveLength(99);
    for (let p = 0; p < 5; p++) {
      expect(map.indexOf(p)).toBeGreaterThanOrEqual(0);
    }
  });
});
