/**
 * Letters Mask Isolation & Image Composition Helper
 *
 * Implements 4-connected iterative flood fill to isolate the 11 letter bodies
 * of "HAYAH SHARKS", discarding small letter holes (counters), dilating by 2px
 * to tuck under outlines, and composing the captured photo inside the letters.
 */

import { getShuffledIndices, createSlotToPhotoMap } from "../mosaic/mosaic-random";

export interface LetterBox {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WordBand {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LettersMaskData {
  width: number;
  height: number;
  logoImg: HTMLImageElement;
  maskCanvas: HTMLCanvasElement;
  wordBand: WordBand;
  letters: LetterBox[];
}

let cachedMask: LettersMaskData | null = null;
let pendingPromise: Promise<LettersMaskData> | null = null;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load logo image from: ${src}`));
    img.src = src;
  });
}

/**
 * Isolates the 11 letter bodies from the HAYAH SHARKS logo.
 * Runs once and is cached in memory.
 */
export async function getOrComputeLettersMask(
  logoSrc: string = "/hayah-sharks-logo.png"
): Promise<LettersMaskData> {
  if (cachedMask) return cachedMask;
  if (pendingPromise) return pendingPromise;

  pendingPromise = (async () => {
    const logoImg = await loadImage(logoSrc);
    const w = logoImg.naturalWidth || logoImg.width;
    const h = logoImg.naturalHeight || logoImg.height;

    if (!w || !h) {
      throw new Error("Logo image has invalid dimensions");
    }

    // 1. Draw logo on an offscreen canvas and read RGBA pixels
    const offscreen = document.createElement("canvas");
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Could not initialize 2D context for letter mask");

    ctx.drawImage(logoImg, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    const pixels = imgData.data;

    // 2. Transparent map: alpha < 128
    const totalPixels = w * h;
    const transparent = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      transparent[i] = pixels[i * 4 + 3] < 128 ? 1 : 0;
    }

    // 3. Iterative flood fill (4-connected, typed-array stack) from border
    const outside = new Uint8Array(totalPixels);
    const queue = new Int32Array(totalPixels);
    let head = 0;
    let tail = 0;

    const pushBorder = (idx: number) => {
      if (transparent[idx] && !outside[idx]) {
        outside[idx] = 1;
        queue[tail++] = idx;
      }
    };

    for (let x = 0; x < w; x++) {
      pushBorder(x);
      pushBorder((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      pushBorder(y * w);
      pushBorder(y * w + (w - 1));
    }

    while (head < tail) {
      const idx = queue[head++];
      const x = idx % w;
      const y = Math.floor(idx / w);

      if (x > 0 && transparent[idx - 1] && !outside[idx - 1]) {
        outside[idx - 1] = 1;
        queue[tail++] = idx - 1;
      }
      if (x < w - 1 && transparent[idx + 1] && !outside[idx + 1]) {
        outside[idx + 1] = 1;
        queue[tail++] = idx + 1;
      }
      if (y > 0 && transparent[idx - w] && !outside[idx - w]) {
        outside[idx - w] = 1;
        queue[tail++] = idx - w;
      }
      if (y < h - 1 && transparent[idx + w] && !outside[idx + w]) {
        outside[idx + w] = 1;
        queue[tail++] = idx + w;
      }
    }

    // 4. Remaining transparent pixels are enclosed by outline. Find connected components.
    const visited = new Uint8Array(totalPixels);
    interface Component {
      area: number;
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
      pixelIndices: number[];
    }
    const components: Component[] = [];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (transparent[idx] && !outside[idx] && !visited[idx]) {
          let cHead = 0;
          let cTail = 0;
          queue[cTail++] = idx;
          visited[idx] = 1;

          let minX = x;
          let maxX = x;
          let minY = y;
          let maxY = y;
          let area = 0;
          const compPixels: number[] = [];

          while (cHead < cTail) {
            const cIdx = queue[cHead++];
            area++;
            compPixels.push(cIdx);
            const cx = cIdx % w;
            const cy = Math.floor(cIdx / w);

            if (cx < minX) minX = cx;
            if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy;
            if (cy > maxY) maxY = cy;

            if (cx > 0 && transparent[cIdx - 1] && !outside[cIdx - 1] && !visited[cIdx - 1]) {
              visited[cIdx - 1] = 1;
              queue[cTail++] = cIdx - 1;
            }
            if (cx < w - 1 && transparent[cIdx + 1] && !outside[cIdx + 1] && !visited[cIdx + 1]) {
              visited[cIdx + 1] = 1;
              queue[cTail++] = cIdx + 1;
            }
            if (cy > 0 && transparent[cIdx - w] && !outside[cIdx - w] && !visited[cIdx - w]) {
              visited[cIdx - w] = 1;
              queue[cTail++] = cIdx - w;
            }
            if (cy < h - 1 && transparent[cIdx + w] && !outside[cIdx + w] && !visited[cIdx + w]) {
              visited[cIdx + w] = 1;
              queue[cTail++] = cIdx + w;
            }
          }

          components.push({ area, minX, maxX, minY, maxY, pixelIndices: compPixels });
        }
      }
    }

    if (components.length === 0) {
      throw new Error("No enclosed letter components detected in the logo");
    }

    // 5. Keep only large components (area >= 30% of median component area)
    const areas = components.map(c => c.area).sort((a, b) => a - b);
    const medianArea = areas[Math.floor(areas.length / 2)];
    const kept = components.filter(c => c.area >= 0.3 * medianArea);

    // 6. Compute union bounding box of kept components (word band) & individual letter boxes
    kept.sort((a, b) => a.minX - b.minX);
    const letters: LetterBox[] = kept.map((c, idx) => ({
      id: idx + 1,
      x: c.minX,
      y: c.minY,
      w: c.maxX - c.minX + 1,
      h: c.maxY - c.minY + 1,
    }));
    const bandX = Math.min(...kept.map(c => c.minX));
    const bandY = Math.min(...kept.map(c => c.minY));
    const bandMaxX = Math.max(...kept.map(c => c.maxX));
    const bandMaxY = Math.max(...kept.map(c => c.maxY));
    const wordBand: WordBand = {
      x: bandX,
      y: bandY,
      width: bandMaxX - bandX + 1,
      height: bandMaxY - bandY + 1,
    };

    // 7. Paint kept components into mask canvas, then grow by 2px (draw at 9 offsets)
    const rawMaskCanvas = document.createElement("canvas");
    rawMaskCanvas.width = w;
    rawMaskCanvas.height = h;
    const rawCtx = rawMaskCanvas.getContext("2d");
    if (!rawCtx) throw new Error("Could not initialize raw mask context");

    const maskImgData = rawCtx.createImageData(w, h);
    const maskDataArr = maskImgData.data;
    for (const comp of kept) {
      for (const idx of comp.pixelIndices) {
        const offset = idx * 4;
        maskDataArr[offset] = 255;
        maskDataArr[offset + 1] = 255;
        maskDataArr[offset + 2] = 255;
        maskDataArr[offset + 3] = 255;
      }
    }
    rawCtx.putImageData(maskImgData, 0, 0);

    const grownMaskCanvas = document.createElement("canvas");
    grownMaskCanvas.width = w;
    grownMaskCanvas.height = h;
    const grownCtx = grownMaskCanvas.getContext("2d");
    if (!grownCtx) throw new Error("Could not initialize grown mask context");

    const offsets = [-2, 0, 2];
    for (const dy of offsets) {
      for (const dx of offsets) {
        grownCtx.drawImage(rawMaskCanvas, dx, dy);
      }
    }

    cachedMask = {
      width: w,
      height: h,
      logoImg,
      maskCanvas: grownMaskCanvas,
      wordBand,
      letters,
    };

    return cachedMask;
  })();

  try {
    return await pendingPromise;
  } finally {
    pendingPromise = null;
  }
}

/**
 * Composes the captured photo inside the HAYAH SHARKS letters.
 * Photo appears ONLY inside the 11 letter bodies; shark, black outlines,
 * and gaps remain unchanged.
 */
export function composeLettersImage(
  photoElement: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maskData: LettersMaskData
): HTMLCanvasElement {
  const { width, height, logoImg, maskCanvas, wordBand } = maskData;

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = width;
  outputCanvas.height = height;
  const ctx = outputCanvas.getContext("2d");
  if (!ctx) throw new Error("Could not initialize output composition context");

  // Cover fit into wordBand: scale = max(bandW / photoW, bandH / photoH), centered
  const scale = Math.max(wordBand.width / sourceWidth, wordBand.height / sourceHeight);
  const drawW = sourceWidth * scale;
  const drawH = sourceHeight * scale;

  const bandCenterX = wordBand.x + wordBand.width / 2;
  const bandCenterY = wordBand.y + wordBand.height / 2;
  const drawX = bandCenterX - drawW / 2;
  const drawY = bandCenterY - drawH / 2;

  // 1. Draw captured photo clipped to word band
  ctx.save();
  ctx.beginPath();
  ctx.rect(wordBand.x, wordBand.y, wordBand.width, wordBand.height);
  ctx.clip();
  ctx.drawImage(photoElement, drawX, drawY, drawW, drawH);
  ctx.restore();

  // 2. destination-in with mask canvas: keeps photo only inside letters
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(maskCanvas, 0, 0);

  // 3. source-over: draw original logo on top (black outlines and shark)
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(logoImg, 0, 0);

  return outputCanvas;
}

/**
 * Draws an image with cover fit inside a bounding rectangle with optional zoom & pan offsets.
 */
export function drawLettersCover(
  c: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  r: { x: number; y: number; w: number; h: number },
  zoom: number = 1,
  ox: number = 0,
  oy: number = 0
): void {
  const iw = (img as HTMLImageElement).naturalWidth || img.width;
  const ih = (img as HTMLImageElement).naturalHeight || img.height;
  if (!iw || !ih) return;
  const s = Math.max(r.w / iw, r.h / ih) * zoom;
  const dw = iw * s;
  const dh = ih * s;
  const x = r.x + (r.w - dw) / 2 + (ox * (dw - r.w)) / 2;
  const y = r.y + (r.h - dh) / 2 + (oy * (dh - r.h)) / 2;
  c.save();
  c.beginPath();
  c.rect(r.x, r.y, r.w, r.h);
  c.clip();
  c.drawImage(img, x, y, dw, dh);
  c.restore();
}

/**
 * Creates subtle placeholder sample canvases matching Hayah Sharks Booth reference.
 */
export function createSampleToneCanvases(): HTMLCanvasElement[] {
  const tones = [
    ["#f2b27a", "#c4552d"],
    ["#8fd0c4", "#2a7f86"],
    ["#c7a6ef", "#5b3fa8"],
  ];
  return tones.map(([top, btm]) => {
    const c = document.createElement("canvas");
    c.width = 600;
    c.height = 800;
    const g = c.getContext("2d");
    if (!g) return c;
    const bg = g.createLinearGradient(0, 0, 0, 800);
    bg.addColorStop(0, top);
    bg.addColorStop(1, btm);
    g.fillStyle = bg;
    g.fillRect(0, 0, 600, 800);
    g.fillStyle = "rgba(20, 33, 63, 0.85)";
    g.beginPath();
    g.ellipse(300, 820, 270, 250, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(255, 226, 200, 0.95)";
    g.beginPath();
    g.ellipse(300, 330, 120, 150, 0, 0, Math.PI * 2);
    g.fill();
    return c;
  });
}

export type LettersDisplayMode = "grid" | "dense" | "strip" | "letter";

export interface LetterGridCell {
  letterIdx: number;
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Computes all grid cells across the 11 letters.
 * - "grid": 3 cols x 3 rows per letter = 99 cells
 * - "dense": 4 cols x 4 rows per letter = 176 cells
 * - "letter": 2 cols x 3 rows per letter = 66 cells
 */
export function getLetterGridCells(
  letters: LetterBox[],
  mode: LettersDisplayMode = "grid"
): LetterGridCell[] {
  let cols = 3;
  let rows = 3;
  if (mode === "dense") {
    cols = 4;
    rows = 4;
  } else if (mode === "letter") {
    cols = 2;
    rows = 3;
  }

  const cells: LetterGridCell[] = [];
  letters.forEach((l, letterIdx) => {
    const cellW = l.w / cols;
    const cellH = l.h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells.push({
          letterIdx,
          row: r,
          col: c,
          x: l.x + c * cellW,
          y: l.y + r * cellH,
          w: cellW,
          h: cellH,
        });
      }
    }
  });
  return cells;
}

/**
 * Renders photos into the Hayah Sharks letters in multiple horizontal rows:
 * - "grid": photo mosaic grid (3 rows x 3 cols per letter = 99 cells)
 * - "dense": high-density mosaic grid (4 rows x 4 cols per letter = 176 cells)
 * - "strip": multi-row word-band grid (3 stacked rows across the full letters band)
 */
export function renderLettersStage(
  targetCtx: CanvasRenderingContext2D,
  maskData: LettersMaskData,
  photos: (HTMLImageElement | HTMLCanvasElement)[],
  mode: LettersDisplayMode = "grid",
  zoom: number = 1,
  ox: number = 0,
  oy: number = 0,
  samplesFallback: boolean = true
): void {
  const { width: W, height: H, logoImg, maskCanvas, wordBand, letters } = maskData;
  const layer = document.createElement("canvas");
  layer.width = W;
  layer.height = H;
  const lc = layer.getContext("2d");
  if (!lc) return;

  const activePhotos = photos;

  lc.globalCompositeOperation = "source-over";
  lc.clearRect(0, 0, W, H);

  if (mode === "strip") {
    // Multi-row word-band grid (3 stacked rows across the entire word band)
    const rows = 3;
    const cols = Math.max(8, Math.min(32, Math.ceil(activePhotos.length / rows) || 12));
    const cellW = wordBand.width / cols;
    const cellH = wordBand.height / rows;
    const totalCells = rows * cols;
    const slotToPhoto = createSlotToPhotoMap(totalCells, activePhotos.length, "letters-strip-random-order");
    const gap = 2;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const slotIdx = r * cols + c;
        const photoIdx = slotToPhoto[slotIdx];
        const drawBox = {
          x: wordBand.x + c * cellW + gap / 2,
          y: wordBand.y + r * cellH + gap / 2,
          w: Math.max(1, cellW - gap),
          h: Math.max(1, cellH - gap),
        };

        if (photoIdx >= 0 && photoIdx < activePhotos.length) {
          drawLettersCover(lc, activePhotos[photoIdx], drawBox, zoom, ox, oy);
          // Crisp visible tile separation border
          lc.strokeStyle = "rgba(255, 255, 255, 0.35)";
          lc.lineWidth = 1.0;
          lc.strokeRect(drawBox.x, drawBox.y, drawBox.w, drawBox.h);
        } else if (samplesFallback) {
          lc.fillStyle = "rgba(255, 255, 255, 0.08)";
          lc.fillRect(drawBox.x, drawBox.y, drawBox.w, drawBox.h);
          lc.strokeStyle = "rgba(255, 255, 255, 0.14)";
          lc.lineWidth = 0.8;
          lc.strokeRect(drawBox.x, drawBox.y, drawBox.w, drawBox.h);
        }
      }
    }
  } else {
    // Grid mode: Photo mosaic grid inside each letter (3x3 or 4x4 rows)
    const cells = getLetterGridCells(letters, mode);
    const slotToPhoto = createSlotToPhotoMap(cells.length, activePhotos.length, "letters-grid-random-order");
    const gap = mode === "dense" ? 1.5 : 2.0;

    cells.forEach((cell, i) => {
      const photoIndex = slotToPhoto[i];
      const drawBox = {
        x: cell.x + gap / 2,
        y: cell.y + gap / 2,
        w: Math.max(1, cell.w - gap),
        h: Math.max(1, cell.h - gap),
      };

      if (photoIndex >= 0 && photoIndex < activePhotos.length) {
        drawLettersCover(lc, activePhotos[photoIndex], drawBox, zoom, ox, oy);
        // Crisp visible tile separation border to make the multiple rows distinct and aesthetic
        lc.strokeStyle = "rgba(255, 255, 255, 0.35)";
        lc.lineWidth = 1.0;
        lc.strokeRect(drawBox.x, drawBox.y, drawBox.w, drawBox.h);
      } else if (samplesFallback) {
        // Aesthetic placeholder tile
        lc.fillStyle = "rgba(255, 255, 255, 0.08)";
        lc.fillRect(drawBox.x, drawBox.y, drawBox.w, drawBox.h);
        lc.strokeStyle = "rgba(255, 255, 255, 0.14)";
        lc.lineWidth = 0.8;
        lc.strokeRect(drawBox.x, drawBox.y, drawBox.w, drawBox.h);
      }
    });
  }

  // Clip photos strictly inside the letter shapes
  lc.globalCompositeOperation = "destination-in";
  lc.drawImage(maskCanvas, 0, 0);

  // Paint onto destination canvas and overlay original sharp logo outlines & shark
  targetCtx.clearRect(0, 0, W, H);
  targetCtx.drawImage(layer, 0, 0);
  targetCtx.drawImage(logoImg, 0, 0);
}
