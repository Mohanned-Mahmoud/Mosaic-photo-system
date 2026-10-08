export const ACCEPTED_PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const JPEG_START = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_START = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const WEBP_CHUNKS = new Set(["VP8 ", "VP8L", "VP8X"]);

export function hasValidImageSignature(mimeType: string, bytes: Buffer): boolean {
  if (mimeType === "image/jpeg") {
    return bytes.length >= 5 && bytes.subarray(0, 3).equals(JPEG_START) &&
      bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  }

  if (mimeType === "image/png") {
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_START)) return false;
    return bytes.subarray(bytes.length - PNG_IEND.length).equals(PNG_IEND);
  }

  if (mimeType !== "image/webp" || bytes.length < 25) return false;
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return false;
  if (bytes.readUInt32LE(4) !== bytes.length - 8) return false;

  const chunkType = bytes.toString("ascii", 12, 16);
  const chunkLength = bytes.readUInt32LE(16);
  return WEBP_CHUNKS.has(chunkType) && chunkLength > 0 && chunkLength <= bytes.length - 20;
}
