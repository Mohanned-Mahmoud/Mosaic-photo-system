import { z } from "zod";

export const eventIdSchema = z
  .string()
  .min(8)
  .max(32)
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid event identifier");
export const uuidSchema = z.uuid();
export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const eventBrandingSchema = z
  .object({
    backgroundColor: hexColorSchema,
    primaryColor: hexColorSchema,
    accentColor: hexColorSchema,
    tileGap: z.number().int().min(0).max(16),
    animationSpeed: z.enum(["calm", "cinematic", "energetic"]),
    logoPosition: z.enum(["center", "top-left", "top-right"]),
    logoScale: z.number().int().min(10).max(100),
    logoAnimation: z.enum(["reveal", "none"]),
    theme: z.enum(["dark", "light"]),
    logoDisplayMode: z.enum(["mask", "watermark", "inverted-mask", "letters"]).optional(),
    lettersMode: z.enum(["strip", "letter", "grid", "dense"]).default("grid").optional(),
    watermarkOpacity: z.number().int().min(0).max(100),
    watermarkBlendMode: z.enum(["overlay", "multiply", "screen", "soft-light", "hard-light", "normal"]),
    watermarkScale: z.number().int().min(10).max(200),
    watermarkPosition: z.enum(["center", "top-left", "top-right", "bottom-left", "bottom-right"]),
    maskCorners: z.array(z.number().min(0).max(1)).length(8).optional(),
    targetLogos: z.array(z.string()).default([]),
    autoAdvance: z.boolean().default(true),
    autoAdvanceDelay: z.number().int().min(1).max(60).default(5),
    arrivalHoldDuration: z.number().min(0.5).max(15).default(3).optional(),
  })
  .strict();

export type EventBranding = z.infer<typeof eventBrandingSchema>;

export const DEFAULT_BRANDING: EventBranding = {
  backgroundColor: "#11100F",
  primaryColor: "#E49A62",
  accentColor: "#E49A62",
  tileGap: 4,
  animationSpeed: "cinematic",
  logoPosition: "center",
  logoScale: 50,
  logoAnimation: "reveal",
  theme: "dark",
  logoDisplayMode: "watermark",
  lettersMode: "grid",
  watermarkOpacity: 60,
  watermarkBlendMode: "overlay",
  watermarkScale: 72,
  watermarkPosition: "center",
  targetLogos: [],
  autoAdvance: true,
  autoAdvanceDelay: 5,
  arrivalHoldDuration: 3,
};

export const eventSettingsSchema = z
  .object({
    boothMessage: z.string().trim().min(1).max(80),
    showGuestQr: z.boolean(),
    maxPhotos: z.number().int().min(0).max(10000),
  })
  .strict();

export type EventSettings = z.infer<typeof eventSettingsSchema>;

export const DEFAULT_EVENT_SETTINGS: EventSettings = {
  boothMessage: "YOUR PHOTO IS NOW ON THE BIG SCREEN",
  showGuestQr: true,
  maxPhotos: 0,
};

export const createEventInputSchema = z
  .object({ name: z.string().trim().min(2).max(100) })
  .strict();

export const updateEventInputSchema = z
  .object({
    eventId: eventIdSchema,
    name: z.string().trim().min(2).max(100).optional(),
    branding: eventBrandingSchema.optional(),
    settings: eventSettingsSchema.optional(),
  })
  .strict();

export const photoPayloadSchema = z
  .object({
    id: uuidSchema,
    eventId: eventIdSchema,
    boothId: uuidSchema,
    imageUrl: z.string().startsWith("/local-storage/"),
    thumbnailUrl: z.string().startsWith("/local-storage/"),
    createdAt: z.string().datetime(),
    isHidden: z.boolean().optional(),
  })
  .strict();

export type PhotoPayload = z.infer<typeof photoPayloadSchema>;

export const publicEventSchema = z
  .object({
    id: eventIdSchema,
    name: z.string(),
    logoUrl: z.string().nullable(),
    branding: eventBrandingSchema,
    settings: eventSettingsSchema,
    createdAt: z.string().datetime(),
  })
  .strict();

export type PublicEvent = z.infer<typeof publicEventSchema>;

export const mosaicControlSchema = z
  .object({
    playing: z.boolean(),
    revision: z.number().int().nonnegative(),
    restartKey: z.number().int().nonnegative(),
    autoFill: z.boolean().default(false),
    screensaver: z.boolean().default(false),
    targetIndex: z.number().int().nonnegative().default(0),
  })
  .strict();

export type MosaicControl = z.infer<typeof mosaicControlSchema>;

export const mosaicSnapshotSchema = z
  .object({
    event: publicEventSchema,
    control: mosaicControlSchema,
    connectedBooths: z.number().int().nonnegative(),
    photos: z.array(photoPayloadSchema).max(500),
  })
  .strict();

export type MosaicSnapshot = z.infer<typeof mosaicSnapshotSchema>;

export const eventControlInputSchema = z
  .object({
    eventId: eventIdSchema,
    action: z.enum([
      "play",
      "pause",
      "restart",
      "clear",
      "reset",
      "toggle-fill",
      "toggle-screensaver",
      "next-target",
      "prev-target",
      "set-target",
    ]),
    targetIndex: z.number().int().nonnegative().optional(),
  })
  .strict();

export const galleryInputSchema = z
  .object({
    eventId: eventIdSchema,
    cursor: z.string().max(100).optional(),
  })
  .strict();

export const photoLookupInputSchema = z
  .object({ eventId: eventIdSchema, photoId: uuidSchema })
  .strict();

export const uploadLogoInputSchema = z
  .object({
    eventId: eventIdSchema,
    dataUrl: z.string().max(16_000_000),
    mimeType: z.enum(["image/png", "image/svg+xml", "image/jpeg", "image/webp"]),
    append: z.boolean().optional(),
  })
  .strict();
