import type { EventBranding, PhotoPayload } from "../../../../shared/mosaic";
import { computeMaskedGrid } from "./image-mask";
import {
  getOrComputeLettersMask,
  renderLettersStage,
  getLetterGridCells,
  type LettersDisplayMode,
} from "../booth/letters-mask";
import { createSlotToPhotoMap } from "./mosaic-random";

export interface MosaicScreenshotOptions {
  eventName: string;
  photos: PhotoPayload[];
  branding: EventBranding;
  maxPhotos: number;
  logoUrl: string;
  autoFill?: boolean;
  stageIndex?: number;
  totalStages?: number;
  width?: number;
  height?: number;
  onProgress?: (message: string) => void;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const imgW = img.naturalWidth || img.width;
  const imgH = img.naturalHeight || img.height;
  if (!imgW || !imgH) return;

  const scale = Math.max(w / imgW, h / imgH);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (imgW - sw) / 2;
  const sy = (imgH - sh) / 2;

  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function fillRepeatedPhotos(sourcePhotos: PhotoPayload[], targetCount: number): PhotoPayload[] {
  if (sourcePhotos.length === 0 || sourcePhotos.length >= targetCount) {
    return sourcePhotos;
  }
  const result: PhotoPayload[] = [...sourcePhotos];
  let i = 0;
  while (result.length < targetCount) {
    const src = sourcePhotos[i % sourcePhotos.length];
    result.push({
      ...src,
      id: `fill-${result.length}-${src.id}`,
    });
    i++;
  }
  return result;
}

export async function generateMosaicScreenshot(options: MosaicScreenshotOptions): Promise<{ blob: Blob; width: number; height: number }> {
  const {
    photos,
    branding,
    maxPhotos,
    logoUrl,
    autoFill = false,
    onProgress,
  } = options;

  // Use the exact dimensions the screen is currently opened with
  const screenWidth = Math.round(
    options.width && options.width > 0
      ? options.width
      : typeof window !== "undefined" && window.innerWidth > 0
        ? window.innerWidth
        : 1920,
  );
  const screenHeight = Math.round(
    options.height && options.height > 0
      ? options.height
      : typeof window !== "undefined" && window.innerHeight > 0
        ? window.innerHeight
        : 1080,
  );

  const CANVAS_WIDTH = screenWidth;
  const CANVAS_HEIGHT = screenHeight;
  const aspectRatio = CANVAS_WIDTH / CANVAS_HEIGHT;

  onProgress?.(`Initializing canvas (${CANVAS_WIDTH}×${CANVAS_HEIGHT})...`);

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Could not initialize 2D canvas context");

  // Fill background
  ctx.fillStyle = branding.backgroundColor || "#11100F";
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const isMaskMode = branding.logoDisplayMode === "mask";
  const isInvertedMaskMode = branding.logoDisplayMode === "inverted-mask";
  const isLettersMode = branding.logoDisplayMode === "letters";

  // Dedicated high-resolution export for Letters Mode
  if (isLettersMode) {
    onProgress?.("Rendering Hayah Sharks letters stage...");
    const lettersMask = await getOrComputeLettersMask(logoUrl || "/hayah-sharks-logo.png");
    const activeMode: LettersDisplayMode =
      branding.lettersMode === "dense"
        ? "dense"
        : branding.lettersMode === "strip"
        ? "strip"
        : "grid";

    const totalGridSlots = getLetterGridCells(lettersMask.letters, activeMode).length;
    const effectivePhotos = autoFill ? fillRepeatedPhotos(photos, totalGridSlots) : photos;

    const loadedList: HTMLImageElement[] = [];
    for (const p of effectivePhotos.slice(-200)) {
      const img = (await loadImage(p.imageUrl)) || (await loadImage(p.thumbnailUrl));
      if (img) loadedList.push(img);
    }

    const lettersCanvas = document.createElement("canvas");
    lettersCanvas.width = lettersMask.width;
    lettersCanvas.height = lettersMask.height;
    const lCtx = lettersCanvas.getContext("2d");
    if (lCtx) {
      renderLettersStage(
        lCtx,
        lettersMask,
        loadedList,
        activeMode,
        1,
        0,
        0,
        true
      );
      const scale = Math.min((CANVAS_WIDTH * 0.9) / lettersMask.width, (CANVAS_HEIGHT * 0.85) / lettersMask.height);
      const lw = lettersMask.width * scale;
      const lh = lettersMask.height * scale;
      const lx = (CANVAS_WIDTH - lw) / 2;
      const ly = (CANVAS_HEIGHT - lh) / 2;

      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.65)";
      ctx.shadowBlur = Math.round(25 * (CANVAS_WIDTH / 1920));
      ctx.shadowOffsetY = Math.round(8 * (CANVAS_HEIGHT / 1080));
      ctx.drawImage(lettersCanvas, lx, ly, lw, lh);
      ctx.restore();
    }

    onProgress?.(`Exporting PNG file (${CANVAS_WIDTH}×${CANVAS_HEIGHT})...`);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) resolve(result);
          else reject(new Error("Failed to export canvas blob"));
        },
        "image/png",
        1.0
      );
    });
    return { blob, width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
  }

  const usesMaskGrid = isMaskMode || isInvertedMaskMode;
  const targetCapacity = maxPhotos > 0 ? maxPhotos : 112;

  // Exact padding & gap matching the live DOM screen
  const padding = Math.max(3, Math.min(8, Math.round(CANVAS_WIDTH * 0.003)));
  const gap = Math.max(0, branding.tileGap ?? 4);
  const availW = CANVAS_WIDTH - padding * 2;
  const availH = CANVAS_HEIGHT - padding * 2;

  // Load logo image if available
  let logoImg: HTMLImageElement | null = null;
  if (logoUrl) {
    onProgress?.("Loading target logo graphics...");
    logoImg = await loadImage(logoUrl);
  }

  // Draw background ghost logo in mask mode
  if (isMaskMode && logoImg) {
    const scale = Math.min((availW * 0.72) / logoImg.naturalWidth, (availH * 0.72) / logoImg.naturalHeight);
    const lw = logoImg.naturalWidth * scale;
    const lh = logoImg.naturalHeight * scale;
    const lx = (CANVAS_WIDTH - lw) / 2;
    const ly = (CANVAS_HEIGHT - lh) / 2;
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.drawImage(logoImg, lx, ly, lw, lh);
    ctx.restore();
  }

  // Calculate mask data if in mask or inverted-mask mode
  let maskData: { cols: number; rows: number; solidIndices: number[] } | null = null;
  if (usesMaskGrid && logoUrl) {
    onProgress?.("Calculating mosaic mask grid...");
    maskData = await computeMaskedGrid(
      logoUrl,
      targetCapacity,
      aspectRatio,
      isInvertedMaskMode ? "inverted-mask" : "mask",
      branding.logoScale || 48,
    );
  }

  // Determine grid dimensions matching current screen aspect ratio
  let cols: number;
  let rows: number;
  let wallPhotos: PhotoPayload[];

  if (maskData) {
    cols = maskData.cols;
    rows = maskData.rows;
    wallPhotos = autoFill
      ? fillRepeatedPhotos(photos, maskData.solidIndices.length)
      : photos;
  } else {
    if (maxPhotos > 0) {
      rows = Math.max(1, Math.round(Math.sqrt(targetCapacity / aspectRatio)));
      cols = Math.max(1, Math.ceil(targetCapacity / rows));
    } else {
      const minimumTile = Math.max(66, Math.min(160, Math.round(CANVAS_WIDTH * 0.071)));
      cols = Math.max(1, Math.floor((availW + gap) / (minimumTile + gap)));
      const tileSize = (availW - gap * (cols - 1)) / cols;
      rows = Math.max(1, Math.floor((availH + gap) / (tileSize + gap)));
    }
    wallPhotos = autoFill
      ? fillRepeatedPhotos(photos, cols * rows)
      : photos.slice(-(cols * rows));
  }

  const totalCells = cols * rows;
  const tileWidth = (availW - gap * (cols - 1)) / cols;
  const tileHeight = (availH - gap * (rows - 1)) / rows;

  onProgress?.(`Loading and rendering ${wallPhotos.length} photos...`);

  // Batch preload images for rapid drawing
  const loadedPhotoImages = new Map<string, HTMLImageElement>();
  const photoLoadPromises = wallPhotos.map(async (photo) => {
    const img = (await loadImage(photo.imageUrl)) || (await loadImage(photo.thumbnailUrl));
    if (img) loadedPhotoImages.set(photo.id, img);
  });
  await Promise.all(photoLoadPromises);

  // Render tiles
  if (maskData) {
    const solidSlotToPhotoMap = createSlotToPhotoMap(maskData.solidIndices.length, wallPhotos.length, "mask-solid-order");
    for (let index = 0; index < totalCells; index++) {
      const isSolid = maskData.solidIndices.includes(index);
      if (!isSolid) continue;

      const c = index % cols;
      const r = Math.floor(index / cols);
      const x = padding + c * (tileWidth + gap);
      const y = padding + r * (tileHeight + gap);

      const solidIdx = maskData.solidIndices.indexOf(index);
      const photoIndex = solidSlotToPhotoMap[solidIdx];
      const photo = photoIndex !== undefined && photoIndex < wallPhotos.length ? wallPhotos[photoIndex] : null;
      const img = photo ? loadedPhotoImages.get(photo.id) : null;

      if (img) {
        drawImageCover(ctx, img, x, y, tileWidth, tileHeight);
      } else {
        // Draw subtle placeholder tile box matching live screen
        ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
        ctx.fillRect(x, y, tileWidth, tileHeight);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.025)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, tileWidth, tileHeight);
      }
    }
  } else {
    const gridSlotToPhotoMap = createSlotToPhotoMap(totalCells, wallPhotos.length, "watermark-grid-order");
    for (let i = 0; i < totalCells; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = padding + c * (tileWidth + gap);
      const y = padding + r * (tileHeight + gap);

      const photoIndex = gridSlotToPhotoMap[i];
      const photo = photoIndex !== undefined && photoIndex < wallPhotos.length ? wallPhotos[photoIndex] : null;
      const img = photo ? loadedPhotoImages.get(photo.id) : null;

      if (img) {
        drawImageCover(ctx, img, x, y, tileWidth, tileHeight);
      } else {
        // Draw subtle placeholder tile box matching live screen
        ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
        ctx.fillRect(x, y, tileWidth, tileHeight);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.025)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, tileWidth, tileHeight);
      }
    }
  }

  // Draw prominent logo centered in inverted-mask mode
  if (isInvertedMaskMode && logoImg) {
    const scaleFactor = Math.max(0.15, Math.min(0.90, (branding.logoScale || 48) / 100));
    const boxW = CANVAS_WIDTH * scaleFactor;
    const boxH = CANVAS_HEIGHT * scaleFactor;
    const scale = Math.min(boxW / logoImg.naturalWidth, boxH / logoImg.naturalHeight);
    const lw = logoImg.naturalWidth * scale;
    const lh = logoImg.naturalHeight * scale;
    const lx = (CANVAS_WIDTH - lw) / 2;
    const ly = (CANVAS_HEIGHT - lh) / 2;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.65)";
    ctx.shadowBlur = Math.round(20 * (CANVAS_WIDTH / 1920));
    ctx.shadowOffsetY = Math.round(4 * (CANVAS_HEIGHT / 1080));
    ctx.globalAlpha = 0.96;
    ctx.drawImage(logoImg, lx, ly, lw, lh);
    ctx.restore();
  }

  // Draw central watermark overlay in watermark mode
  if (!isMaskMode && !isInvertedMaskMode && !isLettersMode && wallPhotos.length > 0 && logoImg) {
    const vmin = Math.min(CANVAS_WIDTH, CANVAS_HEIGHT);
    const scaleFactor = ((branding.watermarkScale ?? 72) / 100) * vmin;
    const aspect = logoImg.naturalWidth / Math.max(1, logoImg.naturalHeight);
    const lw = aspect >= 1 ? scaleFactor : scaleFactor * aspect;
    const lh = aspect >= 1 ? scaleFactor / aspect : scaleFactor;

    let lx = (CANVAS_WIDTH - lw) / 2;
    let ly = (CANVAS_HEIGHT - lh) / 2;
    const pos = branding.watermarkPosition ?? "center";
    if (pos === "top-left") { lx = CANVAS_WIDTH * 0.05; ly = CANVAS_HEIGHT * 0.05; }
    else if (pos === "top-right") { lx = CANVAS_WIDTH * 0.95 - lw; ly = CANVAS_HEIGHT * 0.05; }
    else if (pos === "bottom-left") { lx = CANVAS_WIDTH * 0.05; ly = CANVAS_HEIGHT * 0.95 - lh; }
    else if (pos === "bottom-right") { lx = CANVAS_WIDTH * 0.95 - lw; ly = CANVAS_HEIGHT * 0.95 - lh; }

    ctx.save();
    ctx.globalAlpha = (branding.watermarkOpacity ?? 60) / 100;
    const blend = branding.watermarkBlendMode ?? "overlay";
    ctx.globalCompositeOperation = blend === "normal" ? "source-over" : (blend as GlobalCompositeOperation);
    ctx.drawImage(logoImg, lx, ly, lw, lh);
    ctx.restore();
  }

  onProgress?.(`Exporting PNG file (${CANVAS_WIDTH}×${CANVAS_HEIGHT})...`);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) resolve(result);
        else reject(new Error("Failed to export canvas blob"));
      },
      "image/png",
      1.0,
    );
  });

  return { blob, width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
}

export async function downloadMosaicScreenshot(options: MosaicScreenshotOptions): Promise<void> {
  const { blob, width, height } = await generateMosaicScreenshot(options);
  const stageSuffix = options.stageIndex !== undefined ? `_Stage${options.stageIndex + 1}` : "";
  const sanitizedName = options.eventName.replace(/[^\w\u0600-\u06FF-]/g, "_").trim() || "Event";
  const filename = `${sanitizedName}${stageSuffix}_Mosaic_${width}x${height}.png`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
