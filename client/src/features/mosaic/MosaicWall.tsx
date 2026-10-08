import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { EventBranding, PhotoPayload } from "../../../../shared/mosaic";
import { getVisibleTileCapacity } from "./mosaic-state";

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
  branding: EventBranding;
  maxPhotos: number;
  onArrivalEnd: () => void;
}

export default function MosaicWall({ photos, arrivalId, animate, branding, maxPhotos, onArrivalEnd }: MosaicWallProps) {
  const wallRef = useRef<HTMLDivElement>(null);
  const [arrival, setArrival] = useState<ArrivalPosition | null>(null);
  const [tileCapacity, setTileCapacity] = useState(() =>
    getVisibleTileCapacity(window.innerWidth, window.innerHeight, branding.tileGap, maxPhotos),
  );
  const visiblePhotos = photos.slice(-tileCapacity);

  useEffect(() => {
    let frame = 0;
    const refreshCapacity = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setTileCapacity(getVisibleTileCapacity(window.innerWidth, window.innerHeight, branding.tileGap, maxPhotos));
      });
    };
    window.addEventListener("resize", refreshCapacity, { passive: true });
    refreshCapacity();
    return () => {
      window.removeEventListener("resize", refreshCapacity);
      window.cancelAnimationFrame(frame);
    };
  }, [branding.tileGap, maxPhotos]);

  useLayoutEffect(() => {
    setArrival(null);
    if (!arrivalId || !animate || !wallRef.current) return;

    const wall = wallRef.current;
    const target = wall.querySelector<HTMLElement>(`[data-photo-id="${arrivalId}"]`);
    if (!target) {
      onArrivalEnd();
      return;
    }

    const wallRect = wall.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const startSize = Math.max(180, Math.min(window.innerWidth * 0.32, window.innerHeight * 0.46, 420));
    const originX = wallRect.width / 2 - startSize / 2;
    const originY = -startSize;
    setArrival({
      size: startSize,
      x: targetRect.left - wallRect.left - originX,
      y: targetRect.top - wallRect.top - originY,
      scaleX: targetRect.width / startSize,
      scaleY: targetRect.height / startSize,
    });
  }, [arrivalId, animate, onArrivalEnd]);

  const arrivalStyle: CSSProperties | undefined = arrival
    ? {
        width: `${arrival.size}px`,
        height: `${arrival.size}px`,
        left: "50%",
        top: `${-arrival.size}px`,
        marginLeft: `${-arrival.size / 2}px`,
        "--arrival-x": `${arrival.x}px`,
        "--arrival-y": `${arrival.y}px`,
        "--arrival-scale-x": arrival.scaleX,
        "--arrival-scale-y": arrival.scaleY,
      } as CSSProperties
    : undefined;

  const gridStyle: CSSProperties | undefined = maxPhotos > 0 ? (() => {
    const rows = Math.round(Math.sqrt(tileCapacity * 9/16));
    const cols = Math.ceil(tileCapacity / Math.max(1, rows));
    return {
      "--grid-cols": cols,
      "--grid-rows": rows,
      "--tile-size": "minmax(0, 1fr)"
    } as CSSProperties;
  })() : undefined;

  return (
    <div
      ref={wallRef}
      className="mosaic-wall"
      style={{ "--tile-gap": `${branding.tileGap}px` } as CSSProperties}
      role="region"
      aria-label={`Live photo mosaic with ${visiblePhotos.length} recent photos`}
    >
      {visiblePhotos.length === 0 ? (
        <div className="mosaic-empty-grid" aria-hidden="true" style={gridStyle}>
          {EMPTY_TILES.map(index => <span key={index} />)}
        </div>
      ) : (
        <div className="mosaic-wall__grid" style={gridStyle}>
          {visiblePhotos.map((photo, index) => (
            <div className={`mosaic-tile${arrivalId === photo.id && animate && arrival ? " mosaic-tile--arriving" : ""}`} key={photo.id} data-photo-id={photo.id}>
              <img
                src={photo.thumbnailUrl}
                alt=""
                loading={index < 24 ? "eager" : "lazy"}
                decoding="async"
                draggable={false}
              />
            </div>
          ))}
        </div>
      )}

      {arrivalId && animate && arrival && (
        <div className="mosaic-arrival" key={arrivalId} style={arrivalStyle} onAnimationEnd={onArrivalEnd} aria-hidden="true">
          <img src={visiblePhotos.find(photo => photo.id === arrivalId)?.thumbnailUrl} alt="" draggable={false} />
        </div>
      )}
    </div>
  );
}
