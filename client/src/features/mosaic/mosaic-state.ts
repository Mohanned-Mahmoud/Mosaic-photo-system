import type { PhotoPayload } from "../../../../shared/mosaic";

export const MAX_WALL_PHOTOS = 320;

export function getVisibleTileCapacity(viewportWidth: number, viewportHeight: number, tileGap = 4, maxPhotos = 0): number {
  if (maxPhotos > 0) {
    const rows = Math.round(Math.sqrt(maxPhotos * 9/16));
    const cols = Math.ceil(maxPhotos / Math.max(1, rows));
    return cols * Math.max(1, rows);
  }
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  const gap = Math.max(0, Math.min(16, tileGap));
  const padding = Math.max(3, Math.min(8, width * 0.003));
  const minimumTile = Math.max(66, Math.min(160, width * 0.071));
  const columns = Math.max(1, Math.floor((width - padding * 2 + gap) / (minimumTile + gap)));
  const tileSize = (width - padding * 2 - gap * (columns - 1)) / columns;
  const rows = Math.max(1, Math.floor((height - padding * 2 + gap) / (tileSize + gap)));
  return Math.min(500, columns * rows);
}

export function mergeWallPhotos(
  existing: readonly PhotoPayload[],
  incoming: readonly PhotoPayload[],
  limit = MAX_WALL_PHOTOS,
): PhotoPayload[] {
  const byId = new Map<string, PhotoPayload>();
  for (const photo of existing) byId.set(photo.id, photo);
  for (const photo of incoming) byId.set(photo.id, photo);
  return Array.from(byId.values())
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    .slice(-limit);
}

export function appendUniquePhoto(
  existing: readonly PhotoPayload[],
  incoming: PhotoPayload,
  limit = MAX_WALL_PHOTOS,
): PhotoPayload[] {
  if (existing.some(photo => photo.id === incoming.id)) return existing as PhotoPayload[];
  return mergeWallPhotos(existing, [incoming], limit);
}

export function getUnseenSnapshotPhotos(
  incoming: readonly PhotoPayload[],
  seenIds: ReadonlySet<string>,
): PhotoPayload[] {
  const knownIds = new Set(seenIds);
  return incoming.filter(photo => {
    if (knownIds.has(photo.id)) return false;
    knownIds.add(photo.id);
    return true;
  });
}
