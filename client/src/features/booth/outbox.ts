import { z } from "zod";
import { eventIdSchema, uuidSchema } from "../../../../shared/mosaic";
import type { PreparedImage } from "./image";

export interface QueuedPhoto {
  id: string;
  eventId: string;
  boothId: string;
  image: Blob;
  thumbnail?: Blob;
  queuedAt: number;
}

const queuedPhotoSchema = z.object({
  id: uuidSchema,
  eventId: eventIdSchema,
  boothId: uuidSchema,
  image: z.instanceof(Blob),
  thumbnail: z.instanceof(Blob).optional(),
  queuedAt: z.number().finite(),
}).strict();

const DATABASE_NAME = "mosaic-photo-outbox";
const STORE_NAME = "photos";
const MAX_QUEUED_PHOTOS = 8;

function openOutbox(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Offline photo queue is unavailable on this device"));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Offline queue could not be opened"));
    request.onblocked = () => reject(new Error("Offline queue is blocked by another kiosk tab"));
  });
}

export async function addQueuedPhoto(photo: QueuedPhoto): Promise<void> {
  const database = await openOutbox();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const countRequest = store.count();
      countRequest.onsuccess = () => {
        const existing = store.get(photo.id);
        existing.onsuccess = () => {
          if (countRequest.result >= MAX_QUEUED_PHOTOS && !existing.result) {
            transaction.abort();
            reject(new Error("The offline queue is full. Reconnect before taking another photo."));
            return;
          }
          store.put(photo);
        };
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Photo could not be queued"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Photo could not be queued"));
    });
  } finally {
    database.close();
  }
}

export async function getQueuedPhotos(eventId: string): Promise<QueuedPhoto[]> {
  const database = await openOutbox();
  try {
    const stored = await new Promise<unknown[]>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as unknown[]);
      request.onerror = () => reject(request.error ?? new Error("Offline photos could not be read"));
    });
    return stored
      .map(value => queuedPhotoSchema.safeParse(value))
      .filter((result): result is { success: true; data: QueuedPhoto } => result.success)
      .map(result => result.data)
      .filter(photo => photo.eventId === eventId)
      .sort((a, b) => a.queuedAt - b.queuedAt);
  } finally {
    database.close();
  }
}

export async function removeQueuedPhoto(photoId: string): Promise<void> {
  const database = await openOutbox();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(photoId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Queued photo could not be removed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Queued photo could not be removed"));
    });
  } finally {
    database.close();
  }
}

export function makeQueuedPhoto(
  id: string,
  eventId: string,
  boothId: string,
  image: PreparedImage,
): QueuedPhoto {
  return { id, eventId, boothId, image: image.image, queuedAt: Date.now() };
}
