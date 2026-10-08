import { describe, expect, it } from "vitest";
import { hasValidImageSignature } from "./image-validation";

function validPngSignatureAndEnd(): Buffer {
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.alloc(8),
    Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
  ]);
}

function validWebpContainer(): Buffer {
  const bytes = Buffer.alloc(25);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WEBP", 8, "ascii");
  bytes.write("VP8L", 12, "ascii");
  bytes.writeUInt32LE(5, 16);
  return bytes;
}

describe("image upload validation", () => {
  it("accepts complete JPEG, PNG, and WebP signatures", () => {
    expect(hasValidImageSignature("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]))).toBe(true);
    expect(hasValidImageSignature("image/png", validPngSignatureAndEnd())).toBe(true);
    expect(hasValidImageSignature("image/webp", validWebpContainer())).toBe(true);
  });

  it("rejects MIME/signature mismatches and truncated image bodies", () => {
    expect(hasValidImageSignature("image/jpeg", Buffer.from("not an image"))).toBe(false);
    expect(hasValidImageSignature("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe(false);
    expect(hasValidImageSignature("image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(false);
    expect(hasValidImageSignature("image/png", Buffer.concat([validPngSignatureAndEnd(), Buffer.from([0])]))).toBe(false);
    expect(hasValidImageSignature("image/webp", Buffer.from("RIFF0000WEBP", "ascii"))).toBe(false);
    expect(hasValidImageSignature("image/svg+xml", Buffer.from("<svg/>"))).toBe(false);
  });
});
