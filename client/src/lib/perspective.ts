// Solves a system of linear equations using Gaussian elimination
function solve(A: number[][], b: number[]): number[] {
  const n = A.length;
  for (let i = 0; i < n; i++) {
    // Find pivot
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) {
        maxRow = k;
      }
    }
    // Swap rows
    [A[i], A[maxRow]] = [A[maxRow], A[i]];
    [b[i], b[maxRow]] = [b[maxRow], b[i]];

    // Make pivot 1 and eliminate others
    const pivot = A[i][i];
    if (Math.abs(pivot) < 1e-10) continue; // Singular matrix fallback

    for (let j = i; j < n; j++) A[i][j] /= pivot;
    b[i] /= pivot;

    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const factor = A[k][i];
      for (let j = i; j < n; j++) A[k][j] -= factor * A[i][j];
      b[k] -= factor * b[i];
    }
  }
  return b;
}

export function getPerspectiveTransform(
  src: [number, number, number, number, number, number, number, number],
  dst: [number, number, number, number, number, number, number, number]
): string {
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const x = src[i * 2];
    const y = src[i * 2 + 1];
    const X = dst[i * 2];
    const Y = dst[i * 2 + 1];

    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    b.push(X);

    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    b.push(Y);
  }

  const h = solve(A, b);
  // h is [h11, h12, h13, h21, h22, h23, h31, h32]
  // The full 3x3 matrix has h33 = 1
  
  // Convert 3x3 homography to CSS 4x4 matrix3d (column-major)
  // [
  //   h11, h21, 0, h31,
  //   h12, h22, 0, h32,
  //   0,   0,   1, 0,
  //   h13, h23, 0, 1
  // ]
  
  return `matrix3d(${h[0]}, ${h[3]}, 0, ${h[6]}, ${h[1]}, ${h[4]}, 0, ${h[7]}, 0, 0, 1, 0, ${h[2]}, ${h[5]}, 0, 1)`;
}
