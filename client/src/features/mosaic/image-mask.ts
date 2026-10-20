export async function computeMaskedGrid(
  imageUrl: string,
  targetSolidCells: number,
  aspectRatio: number,
  mode: "mask" | "inverted-mask" = "mask",
  logoScalePercent: number = 48,
): Promise<{ cols: number; rows: number; solidIndices: number[] }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const safeAspect = aspectRatio > 0 ? aspectRatio : 16 / 9;
      const HIGH_RES_W = 1000;
      const HIGH_RES_H = Math.max(100, Math.round(1000 / safeAspect));
      const canvas = document.createElement("canvas");
      canvas.width = HIGH_RES_W;
      canvas.height = HIGH_RES_H;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        const fallbackCols = Math.round(Math.sqrt((targetSolidCells || 144) * safeAspect));
        const fallbackRows = Math.ceil((targetSolidCells || 144) / Math.max(1, fallbackCols));
        return resolve({ cols: fallbackCols, rows: fallbackRows, solidIndices: [] });
      }

      const imgW = img.naturalWidth || img.width || 1000;
      const imgH = img.naturalHeight || img.height || 1000;
      const maxFraction = mode === "inverted-mask"
        ? Math.max(0.15, Math.min(0.90, (logoScalePercent || 48) / 100))
        : 0.92;
      const scale = Math.min((HIGH_RES_W * maxFraction) / imgW, (HIGH_RES_H * maxFraction) / imgH);
      const drawW = imgW * scale;
      const drawH = imgH * scale;
      const drawX = (HIGH_RES_W - drawW) / 2;
      const drawY = (HIGH_RES_H - drawH) / 2;

      ctx.clearRect(0, 0, HIGH_RES_W, HIGH_RES_H);
      ctx.drawImage(img, drawX, drawY, drawW, drawH);

      const imgData = ctx.getImageData(0, 0, HIGH_RES_W, HIGH_RES_H).data;

      function getSolidIndices(cols: number, rows: number): number[] {
        const indices: number[] = [];
        const cellW = HIGH_RES_W / cols;
        const cellH = HIGH_RES_H / rows;

        for (let r = 0; r < rows; r++) {
          const y0 = Math.floor(r * cellH);
          const y1 = Math.min(HIGH_RES_H, Math.floor((r + 1) * cellH));

          for (let c = 0; c < cols; c++) {
            const x0 = Math.floor(c * cellW);
            const x1 = Math.min(HIGH_RES_W, Math.floor((c + 1) * cellW));

            let solidSamples = 0;
            let totalSamples = 0;

            const stepX = Math.max(1, (x1 - x0) / 8);
            const stepY = Math.max(1, (y1 - y0) / 8);

            for (let sy = y0; sy < y1; sy += stepY) {
              const py = Math.floor(sy);
              for (let sx = x0; sx < x1; sx += stepX) {
                const px = Math.floor(sx);
                totalSamples++;
                const alpha = imgData[(py * HIGH_RES_W + px) * 4 + 3];
                if (alpha > 15) {
                  solidSamples++;
                }
              }
            }

            const ratio = totalSamples > 0 ? solidSamples / totalSamples : 0;
            if (mode === "inverted-mask") {
              // Surrounding tiles: keep cells outside or mostly outside the logo
              if (ratio < 0.15) {
                indices.push(r * cols + c);
              }
            } else {
              // Standard mask: keep cells inside the logo
              if (ratio >= 0.05) {
                indices.push(r * cols + c);
              }
            }
          }
        }
        return indices;
      }

      let bestCols = 16;
      let bestRows = 9;
      let bestIndices: number[] = [];

      if (targetSolidCells > 0) {
        let bestDiff = Infinity;
        const minRows = 7;
        const maxRows = 26;

        for (let r = minRows; r <= maxRows; r++) {
          const c = Math.round(r * safeAspect);
          const indices = getSolidIndices(c, r);
          const diff = Math.abs(indices.length - targetSolidCells);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestCols = c;
            bestRows = r;
            bestIndices = indices;
          }
          if (diff === 0) break;
        }
      } else {
        // Auto Grid: Pick an optimal high-definition resolution (~20x11 for 16:9)
        bestRows = 11;
        bestCols = Math.round(bestRows * safeAspect);
        bestIndices = getSolidIndices(bestCols, bestRows);
      }

      if (bestIndices.length === 0) {
        bestRows = 9;
        bestCols = 16;
        bestIndices = Array.from({ length: 144 }, (_, i) => i);
      }

      // Sort indices center-outward so photos fill the main body and center of the logo first
      const centerC = bestCols / 2;
      const centerR = bestRows / 2;
      bestIndices.sort((a, b) => {
        const ra = Math.floor(a / bestCols);
        const ca = a % bestCols;
        const rb = Math.floor(b / bestCols);
        const cb = b % bestCols;
        const distA = Math.hypot((ca - centerC) * 1.0, (ra - centerR) * 1.3);
        const distB = Math.hypot((cb - centerC) * 1.0, (rb - centerR) * 1.3);
        return distA - distB;
      });

      resolve({ cols: bestCols, rows: bestRows, solidIndices: bestIndices });
    };

    img.onerror = () => {
      const safeAspect = aspectRatio > 0 ? aspectRatio : 16 / 9;
      const fallbackCols = Math.round(Math.sqrt((targetSolidCells || 144) * safeAspect));
      const fallbackRows = Math.ceil((targetSolidCells || 144) / Math.max(1, fallbackCols));
      resolve({ cols: fallbackCols, rows: fallbackRows, solidIndices: [] });
    };

    img.src = imageUrl;
  });
}


