export async function computeMaskedGrid(
  imageUrl: string,
  targetSolidCells: number,
  aspectRatio: number
): Promise<{ cols: number; rows: number; solidIndices: number[] }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return resolve({ cols: Math.round(Math.sqrt(targetSolidCells * aspectRatio)), rows: Math.ceil(targetSolidCells / Math.max(1, Math.round(Math.sqrt(targetSolidCells * aspectRatio)))), solidIndices: [] });

      // Binary search for the right grid size
      let minScale = 1;
      let maxScale = 500;
      let bestCols = 10;
      let bestRows = 10;
      let bestIndices: number[] = [];

      for (let iter = 0; iter < 15; iter++) {
        const midScale = (minScale + maxScale) / 2;
        const rows = Math.round(midScale);
        const cols = Math.round(midScale * aspectRatio);
        
        canvas.width = cols;
        canvas.height = rows;
        ctx.clearRect(0, 0, cols, rows);

        const imgW = img.width || 1000;
        const imgH = img.height || 1000;
        const imgScale = Math.min(cols / imgW, rows / imgH);
        const w = imgW * imgScale;
        const h = imgH * imgScale;
        const x = (cols - w) / 2;
        const y = (rows - h) / 2;

        ctx.drawImage(img, x, y, w, h);
        
        const imageData = ctx.getImageData(0, 0, cols, rows).data;
        const indices: number[] = [];
        for (let i = 0; i < cols * rows; i++) {
          if (imageData[i * 4 + 3] > 64) {
            indices.push(i);
          }
        }

        if (indices.length >= targetSolidCells) {
          bestCols = cols;
          bestRows = rows;
          bestIndices = indices;
          maxScale = midScale; // Try to find a smaller grid that still fits
        } else {
          minScale = midScale;
        }
      }

      // Safeguard: if the logo is almost entirely transparent, we might get a massive grid.
      // Limit total DOM nodes to ~2500 to prevent browser crashes.
      if (bestCols * bestRows > 2500) {
         return resolve({ cols: Math.round(Math.sqrt(targetSolidCells * aspectRatio)), rows: Math.ceil(targetSolidCells / Math.max(1, Math.round(Math.sqrt(targetSolidCells * aspectRatio)))), solidIndices: [] });
      }

      resolve({ cols: bestCols, rows: bestRows, solidIndices: bestIndices });
    };
    img.onerror = () => resolve({ cols: Math.round(Math.sqrt(targetSolidCells * aspectRatio)), rows: Math.ceil(targetSolidCells / Math.max(1, Math.round(Math.sqrt(targetSolidCells * aspectRatio)))), solidIndices: [] });
    img.src = imageUrl;
  });
}

