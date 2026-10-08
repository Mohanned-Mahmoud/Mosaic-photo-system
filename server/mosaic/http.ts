import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import multer from "multer";
import { consumeRateLimit } from "./rate-limit";
import { z } from "zod";
import { eventIdSchema, uuidSchema, DEFAULT_EVENT_SETTINGS } from "../../shared/mosaic";
import { storageGetSignedUrl, storagePut } from "../storage";
import {
  getEventById,
  getMosaicSnapshot,
  getPhotoById,
  getPublicPhoto,
  insertPhoto,
  recordBoothPresence,
  toPhotoPayload,
  getPhotoCount,
} from "./repository";
import { addStreamClient, publishPhoto } from "./realtime";
import { ACCEPTED_PHOTO_MIME_TYPES, hasValidImageSignature } from "./image-validation";
import { PhotoProcessingError, processUploadedPhoto } from "./image-processing";

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2_000_000, files: 1, fields: 2, parts: 3 },
  fileFilter: (_request, file, callback) => {
    const allowed = (ACCEPTED_PHOTO_MIME_TYPES as readonly string[]).includes(file.mimetype);
    if (!allowed) {
      callback(new Error("Unsupported image type"));
      return;
    }
    callback(null, true);
  },
});

const uploadFields = photoUpload.fields([
  { name: "image", maxCount: 1 },
]);

function asyncRoute(handler: (request: Request, response: Response) => Promise<void>): RequestHandler {
  return (request, response, next) => {
    void handler(request, response).catch(next);
  };
}

const MAX_SSE_PER_ADDRESS = 128;
const MAX_SSE_PER_EVENT = 1_024;
const activeStreamsByAddress = new Map<string, number>();
const activeStreamsByEvent = new Map<string, number>();

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function decrement(map: Map<string, number>, key: string): void {
  const remaining = (map.get(key) ?? 1) - 1;
  if (remaining <= 0) map.delete(key);
  else map.set(key, remaining);
}

function reserveSseSlot(address: string, eventId: string): (() => void) | null {
  if ((activeStreamsByAddress.get(address) ?? 0) >= MAX_SSE_PER_ADDRESS) return null;
  if ((activeStreamsByEvent.get(eventId) ?? 0) >= MAX_SSE_PER_EVENT) return null;
  increment(activeStreamsByAddress, address);
  increment(activeStreamsByEvent, eventId);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    decrement(activeStreamsByAddress, address);
    decrement(activeStreamsByEvent, eventId);
  };
}

const photoUploadThrottle: RequestHandler = (request, response, next) => {
  const event = eventIdSchema.safeParse(request.params.eventId);
  if (!event.success) {
    response.status(400).json({ error: "Invalid event identifier" });
    return;
  }
  const address = request.ip || request.socket.remoteAddress || "unknown";
  const decision = consumeRateLimit(`photo-ip:${event.data}:${address}`, 300, 60_000);
  if (!decision.allowed) {
    response.setHeader("Retry-After", String(decision.retryAfterSeconds));
    response.status(429).json({ error: "Photo upload rate limit reached. Please try again shortly." });
    return;
  }
  next();
};

const photoDownloadThrottle: RequestHandler = (request, response, next) => {
  const event = eventIdSchema.safeParse(request.params.eventId);
  const photo = uuidSchema.safeParse(request.params.photoId);
  if (!event.success || !photo.success) {
    response.status(400).json({ error: "Invalid event or photo identifier" });
    return;
  }
  const address = request.ip || request.socket.remoteAddress || "unknown";
  const decision = consumeRateLimit(`photo-download:${event.data}:${address}`, 120, 60_000);
  if (!decision.allowed) {
    response.setHeader("Retry-After", String(decision.retryAfterSeconds));
    response.status(429).json({ error: "Photo download rate limit reached. Please try again shortly." });
    return;
  }
  next();
};

function parsePhotoFiles(request: Request, response: Response, next: NextFunction): void {
  uploadFields(request, response, error => {
    if (!error) {
      next();
      return;
    }
    const tooLarge = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE";
    response.status(tooLarge ? 413 : 400).json({
      error: tooLarge ? "Photo exceeds the 2 MB upload limit" : "Photo upload is not valid",
    });
  });
}

function selectFile(request: Request, fieldName: string): Express.Multer.File | undefined {
  const files = request.files;
  if (!files || Array.isArray(files)) return undefined;
  return files[fieldName]?.[0];
}

function sendSse(response: Response, event: string, payload: unknown, id?: string): void {
  if (response.writableEnded) return;
  const idLine = id ? `id: ${id}\n` : "";
  response.write(`${idLine}event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export function registerMosaicHttpRoutes(app: Express): void {
  app.get("/api/events/:eventId/stream", asyncRoute(async (request, response) => {
    const eventResult = eventIdSchema.safeParse(request.params.eventId);
    if (!eventResult.success) {
      response.status(400).json({ error: "Invalid event identifier" });
      return;
    }

    const event = await getEventById(eventResult.data, true);
    if (!event) {
      response.status(404).json({ error: "Event not found" });
      return;
    }

    let boothId: string | null = null;
    if (typeof request.query.boothId === "string") {
      const boothResult = uuidSchema.safeParse(request.query.boothId);
      if (!boothResult.success) {
        response.status(400).json({ error: "Invalid booth identifier" });
        return;
      }
      boothId = boothResult.data;
    }

    const address = request.ip || request.socket.remoteAddress || "unknown";
    const releaseSseSlot = reserveSseSlot(address, eventResult.data);
    if (!releaseSseSlot) {
      response.setHeader("Retry-After", "10");
      response.status(429).json({ error: "Too many live connections; try again shortly." });
      return;
    }

    response.status(200);
    response.set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders();
    response.write("retry: 3000\n\n");

    const connection = addStreamClient(eventResult.data, response, boothId);
    let heartbeat: ReturnType<typeof setInterval> | undefined = setInterval(() => {
      if (!response.writableEnded && !response.destroyed) response.write(": keep-alive\n\n");
      if (boothId) void recordBoothPresence(eventResult.data, boothId).catch(() => undefined);
    }, 20_000);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      connection.close();
      releaseSseSlot();
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = undefined;
    };
    response.on("close", cleanup);
    response.on("error", cleanup);

    if (boothId) {
      void recordBoothPresence(eventResult.data, boothId).catch(error => console.warn("Booth presence update failed", error));
      sendSse(response, "booth-ready", { eventId: eventResult.data });
      connection.activate();
      return;
    }

    try {
      const snapshot = await getMosaicSnapshot(eventResult.data);
      if (!snapshot) {
        cleanup();
        response.end();
        return;
      }
      if (response.writableEnded) return;
      sendSse(response, "snapshot", snapshot, `snapshot-${snapshot.control.revision}`);
      connection.activate();
    } catch (error: unknown) {
      console.warn("Mosaic initial snapshot failed; closing stream for reconnect", error);
      cleanup();
      if (!response.writableEnded) {
        sendSse(response, "stream-error", { message: "Snapshot unavailable; reconnecting." });
        response.end();
      }
    }
  }));

  app.post("/api/events/:eventId/photos", photoUploadThrottle, parsePhotoFiles, asyncRoute(async (request, response) => {
    const eventResult = eventIdSchema.safeParse(request.params.eventId);
    const uploadFieldsResult = z.object({ photoId: uuidSchema, boothId: uuidSchema }).strict().safeParse(request.body);
    if (!eventResult.success || !uploadFieldsResult.success) {
      response.status(400).json({ error: "Invalid event, photo, or booth identifier" });
      return;
    }

    const event = await getEventById(eventResult.data, true);
    if (!event) {
      response.status(404).json({ error: "Event is not accepting photos" });
      return;
    }
    const settings = { ...DEFAULT_EVENT_SETTINGS, ...event.settings };
    if (settings.maxPhotos && settings.maxPhotos > 0) {
      const currentCount = await getPhotoCount(eventResult.data);
      if (currentCount >= settings.maxPhotos) {
        response.status(403).json({ error: "The event has reached its maximum photo limit." });
        return;
      }
    }

    const { photoId, boothId } = uploadFieldsResult.data;
    const boothLimit = consumeRateLimit(`photo-booth:${eventResult.data}:${boothId}`, 30, 60_000);
    if (!boothLimit.allowed) {
      response.setHeader("Retry-After", String(boothLimit.retryAfterSeconds));
      response.status(429).json({ error: "This booth has sent too many photos. Please try again shortly." });
      return;
    }
    const prior = await getPhotoById(photoId);
    if (prior) {
      if (prior.eventId !== eventResult.data || prior.boothId !== boothId) {
        response.status(409).json({ error: "Photo identifier is already in use" });
        return;
      }
      if (prior.hiddenAt) {
        response.status(409).json({ error: "This photo was already hidden" });
        return;
      }
      response.status(200).json({ photo: toPhotoPayload(prior), duplicate: true });
      return;
    }

    const image = selectFile(request, "image");
    if (!image || image.size < 16 || !hasValidImageSignature(image.mimetype, image.buffer)) {
      response.status(400).json({ error: "Upload must contain a valid JPEG, PNG, or WebP photo" });
      return;
    }

    let optimizedImage: Buffer;
    let optimizedThumbnail: Buffer;
    try {
      ({ image: optimizedImage, thumbnail: optimizedThumbnail } = await processUploadedPhoto(image.buffer));
    } catch (error: unknown) {
      response.status(400).json({
        error: error instanceof PhotoProcessingError ? error.message : "Photo data could not be decoded",
      });
      return;
    }

    await recordBoothPresence(eventResult.data, boothId);
    const [storedImage, storedThumbnail] = await Promise.all([
      storagePut(`events/${eventResult.data}/photos/${photoId}/image.jpg`, optimizedImage, "image/jpeg"),
      storagePut(`events/${eventResult.data}/photos/${photoId}/thumbnail.webp`, optimizedThumbnail, "image/webp"),
    ]);
    const inserted = await insertPhoto({
      id: photoId,
      eventId: eventResult.data,
      boothId,
      imageUrl: storedImage.url,
      thumbnailUrl: storedThumbnail.url,
    });
    const photo = toPhotoPayload(inserted.photo);
    if (inserted.inserted) publishPhoto(eventResult.data, photo.id, photo);
    response.status(inserted.inserted ? 201 : 200).json({ photo, duplicate: !inserted.inserted });
  }));

  app.get("/api/events/:eventId/photos/:photoId/download", asyncRoute(async (request, response) => {
    const eventResult = eventIdSchema.safeParse(request.params.eventId);
    const photoResult = uuidSchema.safeParse(request.params.photoId);
    if (!eventResult.success || !photoResult.success) {
      response.status(400).json({ error: "Invalid event or photo identifier" });
      return;
    }

    const photo = await getPublicPhoto(eventResult.data, photoResult.data);
    if (!photo || !photo.imageUrl.startsWith("/local-storage/")) {
      response.status(404).json({ error: "Photo not found" });
      return;
    }

    const storageKey = photo.imageUrl.slice("/local-storage/".length);
    if (!storageKey || storageKey.split("/").some(part => part === ".." || !part)) {
      response.status(404).json({ error: "Photo not found" });
      return;
    }

    try {
      const signedUrl = await storageGetSignedUrl(storageKey);
      const upstream = await fetch(signedUrl, { signal: AbortSignal.timeout(15_000) });
      if (!upstream.ok) {
        response.status(502).json({ error: "Photo download is temporarily unavailable" });
        return;
      }
      const bytes = Buffer.from(await upstream.arrayBuffer());
      if (bytes.length > 2_000_000) {
        response.status(502).json({ error: "Stored photo exceeds the download limit" });
        return;
      }
      response.status(200).set({
        "Content-Type": "image/jpeg",
        "Content-Disposition": `attachment; filename="mosaic-${photoResult.data}.jpg"`,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      }).send(bytes);
    } catch {
      if (!response.headersSent) response.status(502).json({ error: "Photo download is temporarily unavailable" });
    }
  }));
}
