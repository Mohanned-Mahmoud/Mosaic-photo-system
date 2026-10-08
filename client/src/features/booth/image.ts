export interface PreparedImage {
  image: Blob;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Fall through to the HTMLImageElement decoder for browsers with partial ImageBitmap support.
    }
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);
    image.onload = () => resolve({
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(objectUrl),
    });
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("The camera image could not be decoded"));
    };
    image.src = objectUrl;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error("The camera image could not be prepared"));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
}

export async function preparePhoto(sourceBlob: Blob): Promise<PreparedImage> {
  const decoded = await decodeImage(sourceBlob);
  try {
    const sourceScale = Math.min(1, 1600 / Math.max(decoded.width, decoded.height));
    const imageCanvas = document.createElement("canvas");
    imageCanvas.width = Math.max(1, Math.round(decoded.width * sourceScale));
    imageCanvas.height = Math.max(1, Math.round(decoded.height * sourceScale));
    const imageContext = imageCanvas.getContext("2d", { alpha: false });
    if (!imageContext) throw new Error("Image processing is unavailable on this device");
    imageContext.drawImage(decoded.source, 0, 0, imageCanvas.width, imageCanvas.height);

    let image = await canvasBlob(imageCanvas, "image/jpeg", 0.86);
    if (image.size > 1_800_000) {
      const smaller = document.createElement("canvas");
      const scale = Math.min(1, 1280 / Math.max(imageCanvas.width, imageCanvas.height));
      smaller.width = Math.max(1, Math.round(imageCanvas.width * scale));
      smaller.height = Math.max(1, Math.round(imageCanvas.height * scale));
      const smallerContext = smaller.getContext("2d", { alpha: false });
      if (!smallerContext) throw new Error("Image processing is unavailable on this device");
      smallerContext.drawImage(imageCanvas, 0, 0, smaller.width, smaller.height);
      image = await canvasBlob(smaller, "image/jpeg", 0.76);
    }
    if (image.size > 1_900_000) {
      const compact = document.createElement("canvas");
      const scale = Math.min(1, 1024 / Math.max(imageCanvas.width, imageCanvas.height));
      compact.width = Math.max(1, Math.round(imageCanvas.width * scale));
      compact.height = Math.max(1, Math.round(imageCanvas.height * scale));
      const compactContext = compact.getContext("2d", { alpha: false });
      if (!compactContext) throw new Error("Image processing is unavailable on this device");
      compactContext.drawImage(imageCanvas, 0, 0, compact.width, compact.height);
      image = await canvasBlob(compact, "image/jpeg", 0.68);
    }
    if (image.size > 1_950_000) throw new Error("This photo is too large to upload. Try taking it again.");

    return { image };
  } finally {
    decoded.release();
  }
}
