import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { EventBranding, PhotoPayload } from "../../../../shared/mosaic";
import { getVisibleTileCapacity } from "./mosaic-state";
import { computeMaskedGrid } from "./image-mask";
import { getPerspectiveTransform } from "../../lib/perspective";
import MosaicLettersWall from "./MosaicLettersWall";
import { createSlotToPhotoMap } from "./mosaic-random";

const EMPTY_TILES = Array.from({ length: 500 }, (_, index) => index);

interface ArrivalPosition {
  size: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

interface MosaicWallProps {
  photos: PhotoPayload[];
  arrivalId: string | null;
  animate: boolean;
  autoFill?: boolean;
  branding: EventBranding;
  maxPhotos: number;
  logoUrl: string;
  onArrivalEnd: () => void;
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

export default function MosaicWall({ photos, arrivalId, animate, autoFill = false, branding, maxPhotos, logoUrl, onArrivalEnd }: MosaicWallProps) {
  const wallRef = useRef<HTMLDivElement>(null);
  const [arrival, setArrival] = useState<ArrivalPosition | null>(null);
  const [tileCapacity, setTileCapacity] = useState(() =>
    getVisibleTileCapacity(window.innerWidth, window.innerHeight, branding.tileGap, maxPhotos),
  );
  const [wallSize, setWallSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const visiblePhotos = photos.slice(-tileCapacity);

  useEffect(() => {
    let frame = 0;
    const refreshCapacity = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setTileCapacity(getVisibleTileCapacity(window.innerWidth, window.innerHeight, branding.tileGap, maxPhotos));
        if (wallRef.current) {
          setWallSize({ width: wallRef.current.clientWidth, height: wallRef.current.clientHeight });
        }
      });
    };
    window.addEventListener("resize", refreshCapacity, { passive: true });
    // Run once after initial mount to get correct ref size
    setTimeout(refreshCapacity, 0);
    return () => {
      window.removeEventListener("resize", refreshCapacity);
      window.cancelAnimationFrame(frame);
    };
  }, [branding.tileGap, maxPhotos]);

  const [maskData, setMaskData] = useState<{ cols: number; rows: number; solidIndices: number[] } | null>(null);
  const isMaskMode = branding.logoDisplayMode === "mask";
  const isInvertedMaskMode = branding.logoDisplayMode === "inverted-mask";
  const isLettersMode = branding.logoDisplayMode === "letters";
  const usesMaskGrid = isMaskMode || isInvertedMaskMode;

  useEffect(() => {
    let active = true;
    if (usesMaskGrid && logoUrl) {
      const targetCapacity = maxPhotos > 0 ? maxPhotos : 112;
      const aspectRatio = window.innerWidth / window.innerHeight;
      computeMaskedGrid(
        logoUrl,
        targetCapacity,
        aspectRatio,
        isInvertedMaskMode ? "inverted-mask" : "mask",
        branding.logoScale || 48
      ).then(data => {
        if (active) setMaskData(data);
      });
    } else {
      setMaskData(null);
    }
    return () => { active = false; };
  }, [usesMaskGrid, isInvertedMaskMode, logoUrl, maxPhotos, branding.logoScale]);

  useLayoutEffect(() => {
    setArrival(null);
    if (!arrivalId || !animate || !wallRef.current) return;

    const wall = wallRef.current;
    const wallRect = wall.getBoundingClientRect();
    if (wallRect.width <= 0 || wallRect.height <= 0) { onArrivalEnd(); return; }

    // Prominent large spotlight size in the center of the screen
    const startSize = Math.max(260, Math.min(wallRect.width * 0.42, wallRect.height * 0.52, 540));
    const centerScreenX = wallRect.width / 2;
    const centerScreenY = wallRect.height / 2;

    // --- Primary strategy: look up the actual rendered DOM tile ---
    const target = wall.querySelector<HTMLElement>(`[data-photo-id="${arrivalId}"]`);
    if (target) {
      const targetRect = target.getBoundingClientRect();
      const targetCenterX = targetRect.left - wallRect.left + targetRect.width / 2;
      const targetCenterY = targetRect.top - wallRect.top + targetRect.height / 2;
      setArrival({
        size: startSize,
        x: targetCenterX - centerScreenX,
        y: targetCenterY - centerScreenY,
        scaleX: targetRect.width / startSize,
        scaleY: targetRect.height / startSize,
      });
      return;
    }

    // --- Fallback: tile not in DOM (e.g. random slot outside visible slice, mask mode) ---
    // Compute a random-but-stable target position directly from the grid geometry.
    // We seed the random from the arrivalId so the same photo always lands in the same spot.
    let seed = 0;
    for (let i = 0; i < arrivalId.length; i++) seed = (Math.imul(31, seed) + arrivalId.charCodeAt(i)) | 0;
    seed = Math.abs(seed) || 987654;
    const rand = () => { seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };

    // Estimate tile size from the grid CSS variables or fall back to a uniform grid
    const gridEl = wall.querySelector<HTMLElement>(".mosaic-wall__grid");
    let tileW = startSize * 0.3;
    let tileH = startSize * 0.3;
    let targetCenterX = centerScreenX;
    let targetCenterY = centerScreenY;

    if (gridEl) {
      const gridRect = gridEl.getBoundingClientRect();
      const cols = parseInt(getComputedStyle(gridEl).getPropertyValue("--grid-cols") || "8");
      const rows = parseInt(getComputedStyle(gridEl).getPropertyValue("--grid-rows") || "5");
      const safeW = Math.max(1, gridRect.width);
      const safeH = Math.max(1, gridRect.height);
      tileW = safeW / Math.max(1, cols);
      tileH = safeH / Math.max(1, rows);
      // Pick a random tile slot
      const col = Math.floor(rand() * cols);
      const row = Math.floor(rand() * rows);
      const gridOffsetLeft = gridRect.left - wallRect.left;
      const gridOffsetTop = gridRect.top - wallRect.top;
      targetCenterX = gridOffsetLeft + (col + 0.5) * tileW;
      targetCenterY = gridOffsetTop + (row + 0.5) * tileH;
    } else {
      // No grid element visible (e.g. letters mode delegated here accidentally) — random in the wall bounds
      targetCenterX = wallRect.width * (0.1 + rand() * 0.8);
      targetCenterY = wallRect.height * (0.1 + rand() * 0.8);
    }

    setArrival({
      size: startSize,
      x: targetCenterX - centerScreenX,
      y: targetCenterY - centerScreenY,
      scaleX: tileW / startSize,
      scaleY: tileH / startSize,
    });
  }, [arrivalId, animate, onArrivalEnd]);

  const arrivalStyle: CSSProperties | undefined = arrival
    ? ({
        width: `${arrival.size}px`,
        height: `${arrival.size}px`,
        left: "50%",
        top: "50%",
        marginLeft: `${-arrival.size / 2}px`,
        marginTop: `${-arrival.size / 2}px`,
        transformOrigin: "center center",
        "--arrival-x": `${arrival.x}px`,
        "--arrival-y": `${arrival.y}px`,
        "--arrival-scale-x": arrival.scaleX,
        "--arrival-scale-y": arrival.scaleY,
      } as CSSProperties)
    : undefined;

  const wallAspect = wallSize.width > 0 && wallSize.height > 0 ? wallSize.width / wallSize.height : 16 / 9;
  const standardGridRows = Math.max(1, Math.round(Math.sqrt(tileCapacity / wallAspect)));
  const standardGridCols = Math.max(1, Math.ceil(tileCapacity / standardGridRows));
  const totalGridSlots = standardGridCols * standardGridRows;

  const baseGridStyle = maskData
    ? {
        "--grid-cols": maskData.cols,
        "--grid-rows": maskData.rows,
        "--tile-size": "minmax(0, 1fr)",
        gridTemplateColumns: `repeat(${maskData.cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${maskData.rows}, minmax(0, 1fr))`,
        width: "100%",
        height: "100%",
      }
    : {
        "--grid-cols": standardGridCols,
        "--grid-rows": standardGridRows,
        "--tile-size": "minmax(0, 1fr)",
        gridTemplateColumns: `repeat(${standardGridCols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${standardGridRows}, minmax(0, 1fr))`,
        width: "100%",
        height: "100%",
      };

  const gridStyle: CSSProperties = {
    ...baseGridStyle,
    ...(isMaskMode && maskData
      ? {
          WebkitMaskImage: "var(--watermark-url)",
          WebkitMaskPosition: "center",
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskSize: "contain",
          maskImage: "var(--watermark-url)",
          maskPosition: "center",
          maskRepeat: "no-repeat",
          maskSize: "contain",
        }
      : {}),
    ...(branding.maskCorners && branding.maskCorners.length === 8 && wallSize.width > 0
      ? {
          transform: getPerspectiveTransform(
            [0, 0, wallSize.width, 0, wallSize.width, wallSize.height, 0, wallSize.height],
            [
              branding.maskCorners[0] * wallSize.width, branding.maskCorners[1] * wallSize.height,
              branding.maskCorners[2] * wallSize.width, branding.maskCorners[3] * wallSize.height,
              branding.maskCorners[4] * wallSize.width, branding.maskCorners[5] * wallSize.height,
              branding.maskCorners[6] * wallSize.width, branding.maskCorners[7] * wallSize.height,
            ]
          ),
          transformOrigin: '0 0'
        }
      : {})
  } as CSSProperties;

  const wallStyle: CSSProperties = {
    "--tile-gap": `${branding.tileGap}px`,
  } as CSSProperties;

  const wallPhotos = autoFill && maskData
    ? fillRepeatedPhotos(photos, maskData.solidIndices.length)
    : photos;

  const displayGridPhotos = autoFill && !maskData
    ? fillRepeatedPhotos(visiblePhotos, totalGridSlots)
    : visiblePhotos;

  const solidSlotToPhotoMap = maskData
    ? createSlotToPhotoMap(maskData.solidIndices.length, wallPhotos.length, "mask-solid-order")
    : [];

  const gridSlotToPhotoMap = !maskData
    ? createSlotToPhotoMap(totalGridSlots, displayGridPhotos.length, "watermark-grid-order")
    : [];

  if (isLettersMode) {
    return (
      <div
        ref={wallRef}
        className="mosaic-wall mosaic-wall--letters"
        style={wallStyle}
        role="region"
        aria-label={`Live Hayah Sharks Letters Display with ${photos.length} photos`}
      >
        <MosaicLettersWall
          photos={photos}
          arrivalId={arrivalId}
          animate={animate}
          autoFill={autoFill}
          branding={branding}
          logoUrl={logoUrl || "/hayah-sharks-logo.png"}
          onArrivalEnd={onArrivalEnd}
        />
      </div>
    );
  }

  return (
    <div
      ref={wallRef}
      className="mosaic-wall"
      style={wallStyle}
      role="region"
      aria-label={`Live photo mosaic with ${visiblePhotos.length} recent photos`}
    >
      {/* Faint Logo Outline behind the mosaic in mask mode */}
      {isMaskMode && logoUrl && (
        <div className="mosaic-logo-ghost" aria-hidden="true" />
      )}

      {/* Prominent Logo centered in the hollow silhouette for around-logo mode */}
      {isInvertedMaskMode && logoUrl && (
        <div className="mosaic-logo-inverted-center" aria-hidden="true" />
      )}

      <div className="mosaic-wall__grid" style={gridStyle}>
        {maskData ? (
          Array.from({ length: maskData.cols * maskData.rows }).map((_, index) => {
            const isSolid = maskData.solidIndices.includes(index);
            if (!isSolid) {
              return <div key={`empty-${index}`} className="mosaic-tile mosaic-tile--transparent" />;
            }
            const solidIdx = maskData.solidIndices.indexOf(index);
            const photoIndex = solidSlotToPhotoMap[solidIdx];
            const photo = photoIndex !== undefined && photoIndex < wallPhotos.length ? wallPhotos[photoIndex] : null;
            if (!photo) {
              return <div key={`empty-${index}`} className="mosaic-tile mosaic-tile--placeholder" />;
            }

            return (
              <div
                className={`mosaic-tile${arrivalId === photo.id && animate && arrival ? " mosaic-tile--arriving" : ""}`}
                key={`photo-${index}-${photo.id}`}
                data-photo-id={photo.id}
              >
                <img
                  src={photo.thumbnailUrl}
                  alt=""
                  loading={photoIndex < 24 ? "eager" : "lazy"}
                  decoding="async"
                  draggable={false}
                />
              </div>
            );
          })
        ) : (
          Array.from({ length: totalGridSlots }).map((_, slotIndex) => {
            const photoIndex = gridSlotToPhotoMap[slotIndex];
            const photo = photoIndex !== undefined && photoIndex < displayGridPhotos.length ? displayGridPhotos[photoIndex] : null;
            if (!photo) {
              return <div key={`empty-${slotIndex}`} className="mosaic-tile mosaic-tile--placeholder" />;
            }

            return (
              <div
                className={`mosaic-tile${arrivalId === photo.id && animate && arrival ? " mosaic-tile--arriving" : ""}`}
                key={photo.id}
                data-photo-id={photo.id}
              >
                <img
                  src={photo.thumbnailUrl}
                  alt=""
                  loading={photoIndex < 24 ? "eager" : "lazy"}
                  decoding="async"
                  draggable={false}
                />
              </div>
            );
          })
        )}
      </div>

      {/* Central Watermark Overlay across the wall in watermark mode */}
      {!isMaskMode && !isInvertedMaskMode && !isLettersMode && logoUrl && (
        <div className="mosaic-watermark-overlay" aria-hidden="true" />
      )}

      {arrivalId && animate && arrival && (
        <div
          className="mosaic-arrival"
          key={arrivalId}
          style={arrivalStyle}
          onAnimationEnd={(e) => {
            if (e.animationName === "photo-flight-to-slot" || e.animationName.includes("flight")) {
              onArrivalEnd();
            }
          }}
          aria-hidden="true"
        >
          <img
            src={
              visiblePhotos.find((photo) => photo.id === arrivalId)?.thumbnailUrl ||
              photos.find((photo) => photo.id === arrivalId)?.thumbnailUrl ||
              photos.find((photo) => photo.id === arrivalId)?.imageUrl
            }
            alt=""
            draggable={false}
          />
        </div>
      )}
    </div>
  );
}
