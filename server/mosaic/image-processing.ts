import sharp from "sharp";

const MAX_INPUT_PIXELS = 40_000_000;
const MAX_OUTPUT_IMAGE_BYTES = 1_950_000;
const MAX_OUTPUT_THUMBNAIL_BYTES = 250_000;

export class PhotoProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoProcessingError";
  }
}

export interface OptimizedPhoto {
  image: Buffer;
  thumbnail: Buffer;
}

/** Decode untrusted camera bytes, respect EXIF rotation, and produce bounded JPEG/WebP outputs. */
export async function processUploadedPhoto(input: Buffer): Promise<OptimizedPhoto> {
  const decoderOptions = { limitInputPixels: MAX_INPUT_PIXELS };
  const metadata = await sharp(input, decoderOptions).metadata().catch(() => null);
  if (!metadata) throw new PhotoProcessingError("Photo data could not be decoded");

  if (
    !metadata.width || !metadata.height ||
    metadata.width * metadata.height > MAX_INPUT_PIXELS ||
    (metadata.pages ?? 1) > 1
  ) {
    throw new PhotoProcessingError("Photo dimensions or animation are not supported");
  }

  let image: Buffer;
  let thumbnail: Buffer;
  try {
    [image, thumbnail] = await Promise.all([
      sharp(input, decoderOptions)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer(),
      sharp(input, decoderOptions)
        .rotate()
        .resize(320, 320, { fit: "cover", position: "attention" })
        .webp({ quality: 79 })
        .toBuffer(),
    ]);
  } catch {
    throw new PhotoProcessingError("Photo data could not be decoded");
  }

  if (image.length > MAX_OUTPUT_IMAGE_BYTES || thumbnail.length > MAX_OUTPUT_THUMBNAIL_BYTES) {
    throw new PhotoProcessingError("Photo could not be compressed within the event upload limit");
  }

  return { image, thumbnail };
}
