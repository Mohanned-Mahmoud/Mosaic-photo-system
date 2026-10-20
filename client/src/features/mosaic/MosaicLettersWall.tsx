import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { EventBranding, PhotoPayload } from "../../../../shared/mosaic";
import {
  getOrComputeLettersMask,
  renderLettersStage,
  getLetterGridCells,
  type LettersMaskData,
  type LettersDisplayMode,
} from "../booth/letters-mask";
import { getShuffledIndices } from "./mosaic-random";

export interface MosaicLettersWallProps {
  photos: PhotoPayload[];
  arrivalId: string | null;
  animate: boolean;
  autoFill?: boolean;
  branding: EventBranding;
  logoUrl: string;
  onArrivalEnd: () => void;
}

interface ArrivalTarget {
  size: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
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

export default function MosaicLettersWall({
  photos,
  arrivalId,
  animate,
  autoFill = false,
  branding,
  logoUrl,
  onArrivalEnd,
}: MosaicLettersWallProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const [maskData, setMaskData] = useState<LettersMaskData | null>(null);
  const activeMode: LettersDisplayMode =
    branding.lettersMode === "dense"
      ? "dense"
      : branding.lettersMode === "strip"
      ? "strip"
      : "grid";
  const [arrival, setArrival] = useState<ArrivalTarget | null>(null);
  const [imagesLoadedKey, setImagesLoadedKey] = useState(0);

  const loadedImgsRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // Preload and analyze the Hayah Sharks letter mask
  useEffect(() => {
    let active = true;
    const src = logoUrl || "/hayah-sharks-logo.png";
    getOrComputeLettersMask(src)
      .then((data) => {
        if (active) setMaskData(data);
      })
      .catch((err) => {
        console.error("Failed to compute letters mask:", err);
      });
    return () => {
      active = false;
    };
  }, [logoUrl]);

  // Effective photos taking autoFill into account
  const totalGridSlots = maskData ? getLetterGridCells(maskData.letters, activeMode).length : 99;
  const effectivePhotos = autoFill && maskData ? fillRepeatedPhotos(photos, totalGridSlots) : photos;

  // Load photo images asynchronously
  useEffect(() => {
    const map = loadedImgsRef.current;
    let hasNew = false;

    // We take up to 200 photos for high-density letter grids
    const recent = effectivePhotos.slice(-200);
    for (const p of recent) {
      if (!map.has(p.id)) {
        hasNew = true;
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          setImagesLoadedKey((k) => k + 1);
        };
        img.onerror = () => {
          if (p.imageUrl && img.src !== p.imageUrl) {
            img.src = p.imageUrl;
          }
        };
        img.src = p.thumbnailUrl || p.imageUrl;
        map.set(p.id, img);
      }
    }

    if (hasNew) {
      setImagesLoadedKey((k) => k + 1);
    }
  }, [effectivePhotos]);

  // Render letters stage whenever mask, photos, mode, or loaded images change
  useEffect(() => {
    if (!maskData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = maskData.width;
    canvas.height = maskData.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Collect loaded image elements in order of photos
    const recent = effectivePhotos.slice(-200);
    const loadedList: HTMLImageElement[] = [];
    for (const p of recent) {
      const img = loadedImgsRef.current.get(p.id);
      if (img && img.complete && (img.naturalWidth || img.width) > 0) {
        loadedList.push(img);
      }
    }

    renderLettersStage(ctx, maskData, loadedList, activeMode, 1, 0, 0, true);
  }, [maskData, effectivePhotos, activeMode, imagesLoadedKey]);

  // Calculate arrival animation target on the canvas
  // Tracks a pending arrival so we can retry once maskData loads
  const pendingArrivalId = useRef<string | null>(null);

  useLayoutEffect(() => {
    setArrival(null);
    if (!arrivalId || !animate) return;

    // If maskData not ready yet, remember the id and retry when it arrives
    if (!canvasRef.current || !stageRef.current || !maskData) {
      pendingArrivalId.current = arrivalId;
      return;
    }

    pendingArrivalId.current = null;

    const canvas = canvasRef.current;
    const stage = stageRef.current;
    const canvasRect = canvas.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();

    if (canvasRect.width <= 0 || canvasRect.height <= 0) {
      onArrivalEnd();
      return;
    }

    // Photo might still be propagating; use a best-effort index (0 if not found yet)
    const arrivingIdx = Math.max(0, photos.findIndex((p) => p.id === arrivalId));

    const scale = canvasRect.width / maskData.width;
    let targetX = 0;
    let targetY = 0;
    let targetW = 0;
    let targetH = 0;
    const canvasOffsetLeft = canvasRect.left - stageRect.left;
    const canvasOffsetTop = canvasRect.top - stageRect.top;

    if (activeMode === "strip") {
      const rows = 3;
      const cols = Math.max(8, Math.min(32, Math.ceil(photos.length / rows) || 12));
      const cellW = maskData.wordBand.width / cols;
      const cellH = maskData.wordBand.height / rows;
      const totalCells = rows * cols;
      const slotOrder = getShuffledIndices(totalCells, "letters-strip-random-order");
      const assignedSlot = slotOrder[arrivingIdx % totalCells];
      const assignedRow = Math.floor(assignedSlot / cols);
      const assignedCol = assignedSlot % cols;

      targetX = canvasOffsetLeft + (maskData.wordBand.x + assignedCol * cellW) * scale;
      targetY = canvasOffsetTop + (maskData.wordBand.y + assignedRow * cellH) * scale;
      targetW = cellW * scale;
      targetH = cellH * scale;
    } else {
      const cells = getLetterGridCells(maskData.letters, activeMode);
      const totalSlots = cells.length;
      const slotOrder = getShuffledIndices(totalSlots, "letters-grid-random-order");
      const assignedSlot = slotOrder[arrivingIdx % totalSlots];
      const cell = cells[assignedSlot] || cells[0];

      targetX = canvasOffsetLeft + cell.x * scale;
      targetY = canvasOffsetTop + cell.y * scale;
      targetW = cell.w * scale;
      targetH = cell.h * scale;
    }

    const startSize = Math.max(260, Math.min(stageRect.width * 0.42, stageRect.height * 0.52, 540));
    const centerScreenX = stageRect.width / 2;
    const centerScreenY = stageRect.height / 2;

    const targetCenterX = targetX + targetW / 2;
    const targetCenterY = targetY + targetH / 2;

    setArrival({
      size: startSize,
      x: targetCenterX - centerScreenX,
      y: targetCenterY - centerScreenY,
      scaleX: Math.max(0.05, targetW / startSize),
      scaleY: Math.max(0.05, targetH / startSize),
    });
  }, [arrivalId, animate, maskData, activeMode, photos, onArrivalEnd]);

  // Retry if maskData arrived while an arrival was pending
  useLayoutEffect(() => {
    if (maskData && pendingArrivalId.current && pendingArrivalId.current === arrivalId) {
      // Force re-evaluation of the arrival effect by clearing & re-setting
      setArrival(null);
    }
  }, [maskData, arrivalId]);

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

  return (
    <div
      ref={stageRef}
      className="mosaic-letters-stage"
      role="region"
      aria-label="Hayah Sharks Letters Display"
    >
      {/* Top Floating Badge */}
      <div className="mosaic-letters-header">
        <div className="mosaic-letters-badge">
          <span className="mosaic-letters-badge__dot" />
          <span>
            {photos.length === 0
              ? "READY • في انتظار الصور"
              : `${photos.length} ${photos.length === 1 ? "MOMENT" : "MOMENTS"}`}
          </span>
        </div>
      </div>

      {/* Main Canvas rendering the logo and photos inside the letters */}
      <div className="mosaic-letters-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="mosaic-letters-canvas"
          aria-label="Hayah Sharks Logo with photos inside the letters"
        />
      </div>

      {/* Arrival Animation flying into the target letter */}
      {arrivalId && animate && arrival && (
        <div
          className="mosaic-arrival mosaic-arrival--letters"
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
              photos.find((p) => p.id === arrivalId)?.thumbnailUrl ||
              photos.find((p) => p.id === arrivalId)?.imageUrl
            }
            alt=""
            draggable={false}
          />
        </div>
      )}
    </div>
  );
}
