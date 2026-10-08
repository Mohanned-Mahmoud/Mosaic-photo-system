import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { PhotoProcessingError, processUploadedPhoto } from "./image-processing";

describe("server photo processing", () => {
  it("normalizes a real image and creates a square thumbnail", async () => {
    const source = await sharp({
      create: { width: 640, height: 360, channels: 3, background: "#c48156" },
    }).png().toBuffer();

    const processed = await processUploadedPhoto(source);
    const imageMetadata = await sharp(processed.image).metadata();
    const thumbnailMetadata = await sharp(processed.thumbnail).metadata();

    expect(imageMetadata.format).toBe("jpeg");
    expect(imageMetadata.width).toBe(640);
    expect(imageMetadata.height).toBe(360);
    expect(thumbnailMetadata.format).toBe("webp");
    expect(thumbnailMetadata.width).toBe(320);
    expect(thumbnailMetadata.height).toBe(320);
    expect(processed.image.length).toBeLessThan(1_950_000);
    expect(processed.thumbnail.length).toBeLessThan(250_000);
  });

  it("rejects truncated bytes even when file signatures look plausible", async () => {
    await expect(processUploadedPhoto(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9])))
      .rejects.toBeInstanceOf(PhotoProcessingError);
  });

  it("rejects structurally incomplete PNG payloads", async () => {
    const markerOnlyPng = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.alloc(8),
      Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
    ]);
    await expect(processUploadedPhoto(markerOnlyPng)).rejects.toBeInstanceOf(PhotoProcessingError);
  });
});
