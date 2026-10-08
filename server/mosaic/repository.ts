import { and, count, desc, eq, gt, isNull, isNotNull, lt, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { booths, events, mosaicStates, photos, type EventRecord, type PhotoRecord } from "../../drizzle/schema";
import {
  DEFAULT_BRANDING,
  DEFAULT_EVENT_SETTINGS,
  type MosaicControl,
  type PhotoPayload,
  type PublicEvent,
} from "../../shared/mosaic";
import { getDb } from "../db";

const WALL_PHOTO_LIMIT = 320;
const GALLERY_PAGE_SIZE = 36;

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db;
}

export function toPublicEventDto(event: EventRecord): PublicEvent {
  return {
    id: event.id,
    name: event.name,
    logoUrl: event.logoUrl,
    branding: { ...DEFAULT_BRANDING, ...event.branding },
    settings: { ...DEFAULT_EVENT_SETTINGS, ...event.settings },
    createdAt: event.createdAt.toISOString(),
  };
}

export function toPhotoPayload(photo: PhotoRecord): PhotoPayload {
  return {
    id: photo.id,
    eventId: photo.eventId,
    boothId: photo.boothId,
    imageUrl: photo.imageUrl,
    thumbnailUrl: photo.thumbnailUrl,
    createdAt: photo.createdAt.toISOString(),
    isHidden: photo.hiddenAt !== null,
  };
}

export async function getEventById(eventId: string, activeOnly = false): Promise<EventRecord | null> {
  const db = await database();
  const conditions = activeOnly
    ? and(eq(events.id, eventId), eq(events.isActive, true))
    : eq(events.id, eventId);
  const rows = await db.select().from(events).where(conditions).limit(1);
  return rows[0] ?? null;
}

export async function listPublicEvents(): Promise<Array<Pick<EventRecord, "id" | "name" | "createdAt">>> {
  const db = await database();
  return db
    .select({ id: events.id, name: events.name, createdAt: events.createdAt })
    .from(events)
    .where(eq(events.isActive, true))
    .orderBy(desc(events.createdAt));
}

export async function createEvent(name: string): Promise<EventRecord> {
  const db = await database();
  const id = nanoid(12);
  await db.batch([
    db.insert(events).values({
      id,
      ownerOpenId: null,
      name,
      logoUrl: null,
      branding: DEFAULT_BRANDING,
      settings: DEFAULT_EVENT_SETTINGS,
      isActive: true,
    }),
    db.insert(mosaicStates).values({ eventId: id, playing: true, revision: 0, restartKey: 0 })
  ]);
  const event = await getEventById(id);
  if (!event) throw new Error("Created event could not be read back");
  return event;
}

export async function updateEvent(
  eventId: string,
  patch: Partial<Pick<EventRecord, "name" | "branding" | "settings" | "logoUrl">>,
): Promise<EventRecord> {
  const db = await database();
  await db.update(events).set({ ...patch, updatedAt: new Date() }).where(eq(events.id, eventId));
  const event = await getEventById(eventId);
  if (!event) throw new Error("Event not found after update");
  return event;
}

async function ensureControl(eventId: string): Promise<void> {
  const db = await database();
  await db.insert(mosaicStates).values({ eventId, playing: true, revision: 0, restartKey: 0 }).onConflictDoUpdate({
    target: mosaicStates.eventId,
    set: { eventId },
  });
}

export async function getMosaicControl(eventId: string): Promise<MosaicControl> {
  const db = await database();
  let rows = await db.select().from(mosaicStates).where(eq(mosaicStates.eventId, eventId)).limit(1);
  if (rows.length === 0) {
    await ensureControl(eventId);
    rows = await db.select().from(mosaicStates).where(eq(mosaicStates.eventId, eventId)).limit(1);
  }
  const control = rows[0];
  if (!control) throw new Error("Mosaic state is not available");
  return { playing: control.playing, revision: control.revision, restartKey: control.restartKey };
}

export async function getMosaicSnapshot(eventId: string) {
  const event = await getEventById(eventId, true);
  if (!event) return null;

  const [control, connectedBooths, photoRows] = await Promise.all([
    getMosaicControl(eventId),
    countConnectedBooths(eventId),
    (async () => {
      const db = await database();
      const rows = await db
        .select()
        .from(photos)
        .where(and(eq(photos.eventId, eventId), eq(photos.mosaicVisible, true), isNull(photos.hiddenAt)))
        .orderBy(desc(photos.createdAt), desc(photos.id))
        .limit(WALL_PHOTO_LIMIT);
      return rows.reverse();
    })(),
  ]);

  return { event: toPublicEventDto(event), control, connectedBooths, photos: photoRows.map(toPhotoPayload) };
}

export async function getPhotoById(photoId: string, eventId?: string): Promise<PhotoRecord | null> {
  const db = await database();
  const condition = eventId
    ? and(eq(photos.id, photoId), eq(photos.eventId, eventId))
    : eq(photos.id, photoId);
  const rows = await db.select().from(photos).where(condition).limit(1);
  return rows[0] ?? null;
}

export async function getPublicPhoto(eventId: string, photoId: string): Promise<PhotoRecord | null> {
  const event = await getEventById(eventId, true);
  if (!event) return null;
  const photo = await getPhotoById(photoId, eventId);
  return photo && !photo.hiddenAt ? photo : null;
}

export async function insertPhoto(input: {
  id: string;
  eventId: string;
  boothId: string;
  imageUrl: string;
  thumbnailUrl: string;
}): Promise<{ photo: PhotoRecord; inserted: boolean }> {
  const db = await database();
  const existing = await getPhotoById(input.id);
  if (existing) {
    if (existing.eventId !== input.eventId || existing.boothId !== input.boothId) {
      throw new Error("Photo identifier is already associated with another upload");
    }
    if (existing.hiddenAt) throw new Error("Photo was previously hidden");
    return { photo: existing, inserted: false };
  }

  try {
    await db.insert(photos).values(input);
  } catch (error) {
    const raced = await getPhotoById(input.id);
    if (!raced || raced.eventId !== input.eventId || raced.boothId !== input.boothId || raced.hiddenAt) throw error;
    return { photo: raced, inserted: false };
  }

  const photo = await getPhotoById(input.id);
  if (!photo) throw new Error("Stored photo record could not be read back");
  return { photo, inserted: true };
}

export async function recordBoothPresence(eventId: string, boothId: string): Promise<void> {
  const db = await database();
  await db.insert(booths).values({ id: boothId, eventId, lastSeenAt: new Date() }).onConflictDoUpdate({
    target: booths.id,
    set: { eventId, lastSeenAt: new Date() },
  });
}

const BOOTH_ONLINE_WINDOW_MS = 50_000;

export async function countConnectedBooths(eventId: string): Promise<number> {
  const db = await database();
  const cutoff = new Date(Date.now() - BOOTH_ONLINE_WINDOW_MS);
  const rows = await db
    .select({ total: count() })
    .from(booths)
    .where(and(eq(booths.eventId, eventId), gt(booths.lastSeenAt, cutoff)));
  return Number(rows[0]?.total ?? 0);
}

export async function listRecentBooths(eventId: string) {
  const db = await database();
  return db
    .select({ id: booths.id, label: booths.label, lastSeenAt: booths.lastSeenAt })
    .from(booths)
    .where(eq(booths.eventId, eventId))
    .orderBy(desc(booths.lastSeenAt))
    .limit(12);
}

export async function listAdminPhotos(eventId: string, limit = 48): Promise<PhotoRecord[]> {
  const db = await database();
  const recent = await db
    .select()
    .from(photos)
    .where(eq(photos.eventId, eventId))
    .orderBy(desc(photos.createdAt), desc(photos.id))
    .limit(Math.min(Math.max(limit, 1), 60));

  const hidden = await db
    .select()
    .from(photos)
    .where(and(eq(photos.eventId, eventId), isNotNull(photos.hiddenAt)))
    .orderBy(desc(photos.createdAt), desc(photos.id))
    .limit(100);

  const all = [...recent];
  const seen = new Set(all.map(p => p.id));
  for (const h of hidden) {
    if (!seen.has(h.id)) all.push(h);
  }

  all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return all;
}

export async function listGalleryPhotos(eventId: string, cursor?: string) {
  const db = await database();
  const conditions = [eq(photos.eventId, eventId), isNull(photos.hiddenAt)];
  if (cursor) {
    const separator = cursor.indexOf("~");
    const timestamp = separator > 0 ? new Date(cursor.slice(0, separator)) : new Date(Number.NaN);
    const id = separator > 0 ? cursor.slice(separator + 1) : "";
    if (!Number.isFinite(timestamp.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) {
      throw new Error("Invalid gallery cursor");
    }
    conditions.push(
      or(
        lt(photos.createdAt, timestamp),
        and(eq(photos.createdAt, timestamp), lt(photos.id, id)),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(photos)
    .where(and(...conditions))
    .orderBy(desc(photos.createdAt), desc(photos.id))
    .limit(GALLERY_PAGE_SIZE + 1);
  const hasMore = rows.length > GALLERY_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, GALLERY_PAGE_SIZE) : rows;
  const last = page.at(-1);
  return {
    photos: page.map(toPhotoPayload),
    nextCursor: hasMore && last ? `${last.createdAt.toISOString()}~${last.id}` : null,
  };
}

export async function getPhotoCount(eventId: string): Promise<number> {
  const db = await database();
  const rows = await db
    .select({ total: count() })
    .from(photos)
    .where(and(eq(photos.eventId, eventId), isNull(photos.hiddenAt)));
  return Number(rows[0]?.total ?? 0);
}

export async function hidePhoto(eventId: string, photoId: string): Promise<boolean> {
  const db = await database();
  const result = await db
    .update(photos)
    .set({ hiddenAt: new Date(), mosaicVisible: false })
    .where(and(eq(photos.eventId, eventId), eq(photos.id, photoId), isNull(photos.hiddenAt)));
  return Number((result as any).rowCount ?? 0) > 0;
}

export async function unhidePhoto(eventId: string, photoId: string): Promise<boolean> {
  const db = await database();
  const result = await db
    .update(photos)
    .set({ hiddenAt: null, mosaicVisible: true })
    .where(and(eq(photos.eventId, eventId), eq(photos.id, photoId)));
  return Number((result as any).rowCount ?? 0) > 0;
}

export async function updateMosaicControl(
  eventId: string,
  action: MosaicControlAction,
): Promise<MosaicControl> {
  const db = await database();
  await ensureControl(eventId);
  const rows = await db
    .select()
    .from(mosaicStates)
    .where(eq(mosaicStates.eventId, eventId))
    .limit(1);
  const current = rows[0];
  if (!current) throw new Error("Mosaic control state is unavailable");

  if (action === "clear" || action === "reset") {
    await db
      .update(photos)
      .set({ mosaicVisible: false })
      .where(and(eq(photos.eventId, eventId), eq(photos.mosaicVisible, true), isNull(photos.hiddenAt)));
  }

  const next = nextMosaicControlState(current, action);
  await db
    .update(mosaicStates)
    .set({ ...next, updatedAt: new Date() })
    .where(eq(mosaicStates.eventId, eventId));
  return next;
}

export async function getDashboardData(eventId: string) {
  const db = await database();
  const [rows, recentPhotos, recentBooths, control, connectedBooths] = await Promise.all([
    db
      .select({ total: count() })
      .from(photos)
      .where(and(eq(photos.eventId, eventId), isNull(photos.hiddenAt))),
    listAdminPhotos(eventId),
    listRecentBooths(eventId),
    getMosaicControl(eventId),
    countConnectedBooths(eventId),
  ]);
  return {
    photoCount: Number(rows[0]?.total ?? 0),
    photos: recentPhotos.map(toPhotoPayload),
    booths: recentBooths,
    control,
    connectedBooths,
  };
}


import { nextMosaicControlState, type MosaicControlAction } from "./control-state";
