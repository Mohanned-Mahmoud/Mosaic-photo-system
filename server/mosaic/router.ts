import sanitizeHtml from "sanitize-html";
import { TRPCError } from "@trpc/server";
import {
  createEventInputSchema,
  eventControlInputSchema,
  eventIdSchema,
  galleryInputSchema,
  photoLookupInputSchema,
  updateEventInputSchema,
  uploadLogoInputSchema,
  uuidSchema,
} from "../../shared/mosaic";
import { storagePut } from "../storage";
import { publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { hasValidImageSignature } from "./image-validation";
import { publishControl, broadcast } from "./realtime";
import { consumeRateLimit } from "./rate-limit";
import {
  createEvent,
  getDashboardData,
  getEventById,
  getMosaicSnapshot,
  getPublicPhoto,
  hidePhoto,
  unhidePhoto,
  listGalleryPhotos,
  listPublicEvents,
  toPhotoPayload,
  toPublicEventDto,
  updateEvent,
  updateMosaicControl,
} from "./repository";

async function requireActiveEvent(eventId: string): Promise<void> {
  const event = await getEventById(eventId, true);
  if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
}

function publicMutationProcedure(scope: string, limit: number) {
  return publicProcedure.use(({ ctx, next }) => {
    const address = ctx.req.ip || ctx.req.socket.remoteAddress || "unknown";
    const decision = consumeRateLimit(`mosaic:${scope}:${address}`, limit, 60_000);
    if (!decision.allowed) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many changes. Wait a moment and try again." });
    }
    return next();
  });
}

function publicReadProcedure(scope: string, limit: number) {
  return publicProcedure.use(({ ctx, next }) => {
    const address = ctx.req.ip || ctx.req.socket.remoteAddress || "unknown";
    const decision = consumeRateLimit(`mosaic:read:${scope}:${address}`, limit, 60_000);
    if (!decision.allowed) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests. Wait a moment and try again." });
    }
    return next();
  });
}

const publicAdminMutation = publicMutationProcedure("admin", 120);
const publicEventCreation = publicMutationProcedure("create", 10);
const publicEventListing = publicReadProcedure("event-list", 60);
const publicEventLookup = publicReadProcedure("event", 120);
const publicSnapshotLookup = publicReadProcedure("snapshot", 360);
const publicGalleryLookup = publicReadProcedure("gallery", 180);
const publicPhotoLookup = publicReadProcedure("photo", 120);
const publicDashboardLookup = publicReadProcedure("dashboard", 120);

function decodeBase64DataUrl(dataUrl: string, mimeType: "image/png" | "image/svg+xml"): Buffer {
  const prefix = `data:${mimeType};base64,`;
  if (!dataUrl.startsWith(prefix)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a valid PNG or SVG logo" });
  }
  const encoded = dataUrl.slice(prefix.length);
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Logo data is malformed" });
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0 || bytes.length > 1_000_000) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Logo must be smaller than 1 MB" });
  }
  return bytes;
}

function sanitizeLogoSvg(input: Buffer): string {
  const source = input.toString("utf8");
  if (
    !/^\s*<svg(?:\s|>)/i.test(source) ||
    /<!DOCTYPE|<!ENTITY|url\s*\(|javascript:|<\s*(?:image|foreignObject|use|filter|style|script)\b/i.test(source)
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "SVG contains unsupported or unsafe content" });
  }

  const sanitized = sanitizeHtml(source, {
    allowedTags: ["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon"],
    allowedAttributes: {
      svg: ["xmlns", "viewBox", "width", "height", "fill", "stroke", "stroke-width"],
      g: ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity", "transform"],
      path: ["d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity", "transform"],
      rect: ["x", "y", "width", "height", "rx", "ry", "fill", "stroke", "stroke-width", "opacity", "transform"],
      circle: ["cx", "cy", "r", "fill", "stroke", "stroke-width", "opacity", "transform"],
      ellipse: ["cx", "cy", "rx", "ry", "fill", "stroke", "stroke-width", "opacity", "transform"],
      line: ["x1", "y1", "x2", "y2", "stroke", "stroke-width", "opacity", "transform"],
      polyline: ["points", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity", "transform"],
      polygon: ["points", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity", "transform"],
    },
    allowedSchemes: [],
    disallowedTagsMode: "discard",
    parser: { xmlMode: true },
  });

  if (!/^<svg(?:\s|>)/i.test(sanitized.trim())) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Could not read the SVG logo" });
  }
  if (/^<svg\b[^>]*\sxmlns=/i.test(sanitized.trim())) return sanitized;
  return sanitized.replace(/^<svg(?=[\s>])/i, '<svg xmlns="http://www.w3.org/2000/svg"');
}

export const mosaicRouter = router({
  listEvents: publicEventListing.query(() => listPublicEvents()),

  create: publicEventCreation
    .input(createEventInputSchema)
    .mutation(async ({ input }) => toPublicEventDto(await createEvent(input.name))),

  update: publicAdminMutation
    .input(updateEventInputSchema)
    .mutation(async ({ input }) => {
      await requireActiveEvent(input.eventId);
      const { eventId, ...patch } = input;
      if (patch.settings?.maxPhotos) {
        const n = patch.settings.maxPhotos;
        const rows = Math.round(Math.sqrt(n * 9 / 16));
        const cols = Math.ceil(n / Math.max(1, rows));
        patch.settings.maxPhotos = cols * Math.max(1, rows);
      }
      const event = toPublicEventDto(await updateEvent(eventId, patch));
      broadcast(eventId, "branding", { event });
      return event;
    }),

  uploadLogo: publicAdminMutation
    .input(uploadLogoInputSchema)
    .mutation(async ({ input }) => {
      await requireActiveEvent(input.eventId);
      const bytes = decodeBase64DataUrl(input.dataUrl, input.mimeType);
      let content: Buffer | string = bytes;
      let contentType = input.mimeType;
      let extension = "png";

      if (input.mimeType === "image/png") {
        if (!hasValidImageSignature(input.mimeType, bytes)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "The selected file is not a valid PNG" });
        }
      } else {
        content = sanitizeLogoSvg(bytes);
        contentType = "image/svg+xml";
        extension = "svg";
      }

      const stored = await storagePut(`events/${input.eventId}/branding/logo.${extension}`, content, contentType);
      const event = toPublicEventDto(await updateEvent(input.eventId, { logoUrl: stored.url }));
      broadcast(input.eventId, "branding", { event });
      return { logoUrl: stored.url };
    }),

  publicEvent: publicEventLookup
    .input(eventIdSchema)
    .query(async ({ input }) => {
      const event = await getEventById(input, true);
      return event ? toPublicEventDto(event) : null;
    }),

  snapshot: publicSnapshotLookup
    .input(eventIdSchema)
    .query(input => getMosaicSnapshot(input.input)),

  gallery: publicGalleryLookup
    .input(galleryInputSchema)
    .query(async ({ input }) => {
      const event = await getEventById(input.eventId, true);
      if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      try {
        return await listGalleryPhotos(input.eventId, input.cursor);
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid gallery cursor" });
      }
    }),

  publicPhoto: publicPhotoLookup
    .input(photoLookupInputSchema)
    .query(async ({ input }) => {
      const photo = await getPublicPhoto(input.eventId, input.photoId);
      return photo ? toPhotoPayload(photo) : null;
    }),

  dashboard: publicDashboardLookup
    .input(eventIdSchema)
    .query(async ({ input }) => {
      const event = await getEventById(input, true);
      if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      const data = await getDashboardData(input);
      return { event: toPublicEventDto(event), ...data };
    }),

  control: publicAdminMutation
    .input(eventControlInputSchema)
    .mutation(async ({ input }) => {
      await requireActiveEvent(input.eventId);
      const control = await updateMosaicControl(input.eventId, input.action);
      publishControl(input.eventId, control.revision, { ...control, action: input.action });
      return control;
    }),

  hidePhoto: publicAdminMutation
    .input(eventControlInputSchema.pick({ eventId: true }).extend({ photoId: uuidSchema }).strict())
    .mutation(async ({ input }) => {
      const { eventId, photoId } = input;
      await requireActiveEvent(eventId);
      const hidden = await hidePhoto(eventId, photoId);
      if (!hidden) throw new TRPCError({ code: "NOT_FOUND", message: "Photo not found" });
      broadcast(eventId, "photo-hidden", { photoId }, `hidden-${photoId}`);
      return { hidden: true as const };
    }),

  unhidePhoto: publicAdminMutation
    .input(eventControlInputSchema.pick({ eventId: true }).extend({ photoId: uuidSchema }).strict())
    .mutation(async ({ input }) => {
      const { eventId, photoId } = input;
      await requireActiveEvent(eventId);
      const unhidden = await unhidePhoto(eventId, photoId);
      if (!unhidden) throw new TRPCError({ code: "NOT_FOUND", message: "Photo not found" });
      // We don't necessarily need to broadcast unhide to the wall unless we want it to immediately re-enter.
      // Usually it'll just show up in the gallery again. If we want it on the wall, we could broadcast a 'photo' event.
      return { unhidden: true as const };
    }),
});
