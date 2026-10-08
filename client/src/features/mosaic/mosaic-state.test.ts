import { describe, expect, it } from "vitest";
import type { PhotoPayload } from "../../../../shared/mosaic";
import { appendUniquePhoto, getUnseenSnapshotPhotos, getVisibleTileCapacity, mergeWallPhotos } from "./mosaic-state";

function photo(id: string, second: number): PhotoPayload {
  return {
    id: `00000000-0000-4000-8000-${id.padStart(12, "0")}`,
    eventId: "event_1234",
    boothId: "00000000-0000-4000-8000-111111111111",
    imageUrl: "/local-storage/event/image.jpg",
    thumbnailUrl: "/local-storage/event/thumb.webp",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString(),
  };
}

describe("Mosaic photo state", () => {
  it("keeps photos chronological and ignores an existing ID", () => {
    const first = photo("1", 1);
    const second = photo("2", 2);
    expect(appendUniquePhoto([second], first)).toEqual([first, second]);
    expect(appendUniquePhoto([first], first)).toBeInstanceOf(Array);
    expect(appendUniquePhoto([first], first)).toHaveLength(1);
  });

  it("merges duplicates once and bounds the retained wall window", () => {
    const initial = Array.from({ length: 6 }, (_, index) => photo(String(index + 1), index + 1));
    const merged = mergeWallPhotos(initial, [initial[2]!, photo("7", 7)], 4);
    expect(merged.map(item => item.createdAt)).toEqual(initial.slice(3).map(item => item.createdAt).concat(photo("7", 7).createdAt));
    expect(merged).toHaveLength(4);
  });

  it("only treats genuinely new IDs in a database snapshot as arrivals", () => {
    const alreadyOnWall = photo("1", 1);
    const newPhoto = photo("2", 2);
    const repeatedWithinSnapshot = photo("3", 3);
    const result = getUnseenSnapshotPhotos(
      [alreadyOnWall, newPhoto, newPhoto, repeatedWithinSnapshot],
      new Set([alreadyOnWall.id, repeatedWithinSnapshot.id]),
    );
    expect(result).toEqual([newPhoto]);
  });

  it("scales the visible tile budget for 1080p, 1440p, and 4K without exceeding its bound", () => {
    const fullHd = getVisibleTileCapacity(1920, 1080, 4);
    const quadHd = getVisibleTileCapacity(2560, 1440, 4);
    const fourK = getVisibleTileCapacity(3840, 2160, 4);
    expect(fullHd).toBeGreaterThan(50);
    expect(quadHd).toBeGreaterThanOrEqual(fullHd);
    expect(fourK).toBeGreaterThan(quadHd);
    expect(fourK).toBeLessThanOrEqual(500);
    expect(getVisibleTileCapacity(1, 1, 4)).toBe(1);
  });
});
