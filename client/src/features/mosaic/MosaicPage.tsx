import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { z } from "zod";
import { trpc } from "@/lib/trpc";
import { ApertureMark, MosaicWordmark } from "../../components/MosaicBrand";
import {
  eventIdSchema,
  mosaicControlSchema,
  mosaicSnapshotSchema,
  publicEventSchema,
  photoPayloadSchema,
  type EventBranding,
  type MosaicControl,
  type PhotoPayload,
  type PublicEvent,
} from "../../../../shared/mosaic";
import MosaicWall from "./MosaicWall";
import { appendUniquePhoto, getUnseenSnapshotPhotos, getVisibleTileCapacity } from "./mosaic-state";
import { downloadMosaicScreenshot } from "./mosaic-screenshot";

const EMPTY_TILES = Array.from({ length: 500 }, (_, index) => index);

const controlMessageSchema = mosaicControlSchema.extend({
  action: z.enum([
    "play",
    "pause",
    "restart",
    "clear",
    "reset",
    "toggle-fill",
    "toggle-screensaver",
    "next-target",
    "prev-target",
    "set-target",
  ]),
});
const presenceSchema = z.object({ connectedBooths: z.number().int().nonnegative() });
const hiddenMessageSchema = z.object({ photoId: z.string().uuid() });
const brandingMessageSchema = z.object({ event: publicEventSchema });
const EMPTY_BRANDING: EventBranding = {
  backgroundColor: "#11100F",
  primaryColor: "#E49A62",
  accentColor: "#E49A62",
  tileGap: 4,
  animationSpeed: "cinematic",
  logoPosition: "center",
  logoScale: 72,
  logoAnimation: "reveal",
  theme: "dark",
  watermarkOpacity: 60,
  watermarkBlendMode: "overlay",
  watermarkScale: 72,
  watermarkPosition: "center",
};

const defaultLogo = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none"><path d="M40 7 58 17.4v20.8L40 48.6 22 38.2V17.4L40 7Z" stroke="white" stroke-width="3" /><path d="m58 17.4 18 10.4v20.8L58 59V38.2l18-10.4M22 17.4 4 27.8v20.8L22 59V38.2L4 27.8M40 48.6V69.4L22 59m18-10.4 18 10.8M40 7v20.8l18 10.4M40 27.8 22 38.2" stroke="white" stroke-width="3" stroke-linejoin="round" /><path d="M40 27.8 58 38.2 40 48.6 22 38.2l18-10.4Z" fill="white" fill-opacity=".22" /></svg>`;

function readEventId(): string | null {
  const result = eventIdSchema.safeParse(new URLSearchParams(window.location.search).get("eventId"));
  return result.success ? result.data : null;
}

export default function MosaicPage() {
  const eventId = readEventId();
  const snapshotQuery = trpc.mosaic.snapshot.useQuery(eventId ?? "invalid", {
    enabled: Boolean(eventId),
    refetchInterval: 2_500,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const controlMutation = trpc.mosaic.control.useMutation();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [photos, setPhotos] = useState<PhotoPayload[]>([]);
  const [control, setControl] = useState<MosaicControl>({ playing: true, revision: 0, restartKey: 0, autoFill: false, screensaver: false, targetIndex: 0 });
  const [connection, setConnection] = useState<"connecting" | "live" | "reconnecting">("connecting");
  const [connectedBooths, setConnectedBooths] = useState(0);
  const [opening, setOpening] = useState(true);
  const [ambientReveal, setAmbientReveal] = useState(false);
  const [arrivalId, setArrivalId] = useState<string | null>(null);
  const seenIds = useRef(new Set<string>());
  const queuedArrivals = useRef<string[]>([]);
  const activeArrival = useRef(false);
  const activeArrivalId = useRef<string | null>(null);
  const hasSnapshot = useRef(false);
  const priorRestartKey = useRef<number | null>(null);
  const priorTargetIndex = useRef<number | null>(null);
  const lastSnapshotSignature = useRef("");
  const controlRef = useRef(control);
  const autoAdvanceTimer = useRef<number | null>(null);
  const hasTriggeredAdvanceFor = useRef<number | null>(null);

  useEffect(() => { controlRef.current = control; }, [control]);

  const startArrival = useCallback((photoId: string) => {
    if (!controlRef.current.playing) return;
    if (!activeArrival.current) {
      activeArrival.current = true;
      activeArrivalId.current = photoId;
      setArrivalId(photoId);
      return;
    }
    if (queuedArrivals.current.length < 32) queuedArrivals.current.push(photoId);
  }, []);

  const finishArrival = useCallback(() => {
    const next = queuedArrivals.current.shift();
    if (next) {
      activeArrivalId.current = next;
      setArrivalId(next);
      return;
    }
    activeArrival.current = false;
    activeArrivalId.current = null;
    setArrivalId(null);
  }, []);

  const applySnapshot = useCallback((payload: unknown) => {
    const parsed = mosaicSnapshotSchema.safeParse(payload);
    if (!parsed.success || parsed.data.event.id !== eventId) return;
    const next = parsed.data;
    const signature = JSON.stringify(next);
    if (signature === lastSnapshotSignature.current) return;
    lastSnapshotSignature.current = signature;

    const firstSnapshot = !hasSnapshot.current;
    const latestPhotoIds = new Set(next.photos.map(photo => photo.id));
    queuedArrivals.current = queuedArrivals.current.filter(id => latestPhotoIds.has(id));
    if (firstSnapshot) {
      seenIds.current.clear();
    } else if (activeArrivalId.current && !latestPhotoIds.has(activeArrivalId.current)) {
      finishArrival();
    }

    const unseenPhotos = firstSnapshot ? [] : getUnseenSnapshotPhotos(next.photos, seenIds.current);
    for (const photo of unseenPhotos) startArrival(photo.id);
    for (const photo of next.photos) seenIds.current.add(photo.id);
    while (seenIds.current.size > 1_000) {
      seenIds.current.delete(seenIds.current.values().next().value as string);
    }

    setEvent(next.event);
    setPhotos(next.photos);
    setControl(next.control);
    controlRef.current = next.control;
    setConnectedBooths(next.connectedBooths);
    if (firstSnapshot) {
      hasSnapshot.current = true;
      priorRestartKey.current = next.control.restartKey;
      priorTargetIndex.current = next.control.targetIndex;
      setOpening(true);
    } else if (priorRestartKey.current !== next.control.restartKey || priorTargetIndex.current !== next.control.targetIndex) {
      priorRestartKey.current = next.control.restartKey;
      priorTargetIndex.current = next.control.targetIndex;
      setOpening(true);
    }
  }, [eventId, finishArrival, startArrival]);

  useEffect(() => {
    if (snapshotQuery.data) applySnapshot(snapshotQuery.data);
  }, [snapshotQuery.data, applySnapshot]);

  useEffect(() => {
    if (!opening) return;
    const timer = window.setTimeout(() => setOpening(false), 4_200);
    return () => window.clearTimeout(timer);
  }, [opening, control.restartKey, control.targetIndex]);

  useEffect(() => {
    if (!event || opening || event.branding.logoAnimation === "none") return;
    let revealTimeout: number | undefined;
    const interval = window.setInterval(() => {
      setAmbientReveal(true);
      revealTimeout = window.setTimeout(() => setAmbientReveal(false), 2_600);
    }, 45_000);
    return () => {
      window.clearInterval(interval);
      if (revealTimeout !== undefined) window.clearTimeout(revealTimeout);
      setAmbientReveal(false);
    };
  }, [event?.id, event?.branding.logoAnimation, opening]);

  useEffect(() => {
    if (!eventId || snapshotQuery.data?.event.id !== eventId) return;
    let active = true;
    const source = new EventSource(`/api/events/${encodeURIComponent(eventId)}/stream`);
    source.onopen = () => { if (active) setConnection("live"); };
    source.onerror = () => {
      if (active) setConnection(source.readyState === EventSource.CLOSED ? "reconnecting" : "reconnecting");
    };

    source.addEventListener("snapshot", rawEvent => {
      if (!active) return;
      try { applySnapshot(JSON.parse((rawEvent as MessageEvent<string>).data) as unknown); } catch { return; }
    });

    source.addEventListener("photo", rawEvent => {
      if (!active) return;
      let payload: unknown;
      try { payload = JSON.parse((rawEvent as MessageEvent<string>).data); } catch { return; }
      const parsed = photoPayloadSchema.safeParse(payload);
      if (!parsed.success || parsed.data.eventId !== eventId || seenIds.current.has(parsed.data.id)) return;
      seenIds.current.add(parsed.data.id);
      if (seenIds.current.size > 1_000) seenIds.current.delete(seenIds.current.values().next().value as string);

      // If screensaver is active, do NOT display incoming photos on the wall!
      if (controlRef.current.screensaver) {
        return;
      }

      setPhotos(current => appendUniquePhoto(current, parsed.data));
      startArrival(parsed.data.id);
    });

    source.addEventListener("control", rawEvent => {
      if (!active) return;
      let payload: unknown;
      try { payload = JSON.parse((rawEvent as MessageEvent<string>).data); } catch { return; }
      const parsed = controlMessageSchema.safeParse(payload);
      if (!parsed.success) return;
      const { action, ...nextControl } = parsed.data;
      const wasScreensaver = controlRef.current.screensaver;
      setControl(nextControl);
      controlRef.current = nextControl;
      if (action === "clear" || action === "reset") {
        setPhotos([]);
        setArrivalId(null);
        activeArrivalId.current = null;
        queuedArrivals.current = [];
        activeArrival.current = false;
        seenIds.current.clear();
      }
      if (action === "restart" || action === "reset" || action === "next-target" || action === "prev-target" || action === "set-target") setOpening(true);

      // If screensaver was turned off, refetch snapshot to catch up with all saved photos!
      if (wasScreensaver && !nextControl.screensaver) {
        void snapshotQuery.refetch();
      }
    });

    source.addEventListener("photo-hidden", rawEvent => {
      if (!active) return;
      let payload: unknown;
      try { payload = JSON.parse((rawEvent as MessageEvent<string>).data); } catch { return; }
      const parsed = hiddenMessageSchema.safeParse(payload);
      if (!parsed.success) return;
      setPhotos(current => current.filter(photo => photo.id !== parsed.data.photoId));
      queuedArrivals.current = queuedArrivals.current.filter(id => id !== parsed.data.photoId);
      if (activeArrivalId.current === parsed.data.photoId) finishArrival();
    });

    source.addEventListener("presence", rawEvent => {
      if (!active) return;
      let payload: unknown;
      try { payload = JSON.parse((rawEvent as MessageEvent<string>).data); } catch { return; }
      const parsed = presenceSchema.safeParse(payload);
      if (parsed.success) setConnectedBooths(parsed.data.connectedBooths);
    });

    source.addEventListener("branding", rawEvent => {
      if (!active) return;
      let payload: unknown;
      try { payload = JSON.parse((rawEvent as MessageEvent<string>).data); } catch { return; }
      const parsed = brandingMessageSchema.safeParse(payload);
      if (parsed.success && parsed.data.event.id === eventId) setEvent(parsed.data.event);
    });

    return () => {
      active = false;
      source.close();
    };
  }, [eventId, applySnapshot, finishArrival, startArrival, snapshotQuery.data?.event.id]);

  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);

  const branding = event?.branding ?? EMPTY_BRANDING;
  const isLettersMode = branding.logoDisplayMode === "letters";
  const defaultLettersLogo = "/hayah-sharks-logo.png";
  const fallbackLogo = isLettersMode ? defaultLettersLogo : defaultLogo;
  const targetLogos: string[] = (branding.targetLogos && branding.targetLogos.length > 0)
    ? branding.targetLogos
    : (event?.logoUrl ? [event.logoUrl] : [fallbackLogo]);
  const numTargets = Math.max(1, targetLogos.length);
  const activeTargetIndex = (control.targetIndex ?? 0) % numTargets;
  const currentLogoUrl = targetLogos[activeTargetIndex] || fallbackLogo;

  const maxPhotos = event?.settings?.maxPhotos ?? 0;
  const isMask = branding.logoDisplayMode === "mask" || branding.logoDisplayMode === "inverted-mask";
  const boardCapacity = maxPhotos > 0
    ? maxPhotos
    : (isMask
        ? 112
        : (typeof window !== "undefined"
            ? getVisibleTileCapacity(window.innerWidth, window.innerHeight, branding.tileGap, 0)
            : 112));

  // Partition photos per target board
  let boardPhotos: PhotoPayload[];
  if (isLettersMode || numTargets <= 1) {
    // Mode 4 Letters always shows all event photos inside the letters
    boardPhotos = photos;
  } else {
    const stageStart = activeTargetIndex * boardCapacity;
    const stageEnd = stageStart + boardCapacity;
    const stageSlice = photos.slice(stageStart, stageEnd);

    if (stageSlice.length > 0) {
      boardPhotos = stageSlice;
    } else {
      // If the current stage has no photos yet (e.g. operator switched to this target stage
      // before total event photos reached stageStart, or testing stage transitions):
      // NEVER leave the board empty or discard incoming photos!
      // Fallback to all available event photos (or the latest photos up to boardCapacity)
      boardPhotos = photos.slice(-boardCapacity);
    }
  }

  // When autoFill is active and current target has no photos yet, repeat all available event photos
  const effectiveWallPhotos = boardPhotos.length > 0
    ? [...boardPhotos]
    : (control.autoFill ? [...photos] : []);

  // CRITICAL: Ensure arriving photo is ALWAYS present in the wall photos so the arrival
  // animation immediately locates the target tile and never aborts or drops the photo!
  if (arrivalId && !effectiveWallPhotos.some(p => p.id === arrivalId)) {
    const arriving = photos.find(p => p.id === arrivalId);
    if (arriving) {
      effectiveWallPhotos.push(arriving);
    }
  }

  // Auto-advance logic: when board fills up with actual photos, transition to next target logo
  useEffect(() => {
    hasTriggeredAdvanceFor.current = null;
    if (autoAdvanceTimer.current) {
      window.clearTimeout(autoAdvanceTimer.current);
      autoAdvanceTimer.current = null;
    }
  }, [control.targetIndex]);

  useEffect(() => {
    if (!eventId || !event || numTargets <= 1 || branding.autoAdvance === false) return;
    if (!control.playing || control.screensaver) {
      if (autoAdvanceTimer.current) {
        window.clearTimeout(autoAdvanceTimer.current);
        autoAdvanceTimer.current = null;
      }
      return;
    }

    const isBoardFull = boardPhotos.length >= boardCapacity && boardCapacity > 0;
    if (!isBoardFull) return;

    if (hasTriggeredAdvanceFor.current === control.targetIndex) return;

    // Only auto-advance if more photos have actually arrived to start the next stage,
    // or if autoFill is active to showcase the boards.
    const hasPhotosForNextStage = photos.length > (activeTargetIndex + 1) * boardCapacity;
    if (!hasPhotosForNextStage && !control.autoFill) return;

    const delayMs = hasPhotosForNextStage ? 350 : Math.max(1, branding.autoAdvanceDelay ?? 5) * 1000;

    hasTriggeredAdvanceFor.current = control.targetIndex;
    autoAdvanceTimer.current = window.setTimeout(() => {
      const nextTarget = (control.targetIndex + 1) % numTargets;
      controlMutation.mutate({
        eventId,
        action: "set-target",
        targetIndex: nextTarget,
      });
    }, delayMs);

    return () => {
      if (autoAdvanceTimer.current) {
        window.clearTimeout(autoAdvanceTimer.current);
        autoAdvanceTimer.current = null;
      }
    };
  }, [
    boardPhotos.length,
    boardCapacity,
    photos.length,
    activeTargetIndex,
    control.targetIndex,
    control.playing,
    control.screensaver,
    numTargets,
    branding.autoAdvance,
    branding.autoAdvanceDelay,
    eventId,
    event,
    controlMutation,
  ]);

  const handleTakeScreenshot = useCallback(async () => {
    if (!event || isCapturingScreenshot) return;
    setIsCapturingScreenshot(true);
    try {
      const screenEl = document.querySelector<HTMLElement>(".mosaic-screen");
      const rect = screenEl?.getBoundingClientRect();
      const screenWidth = Math.round(rect?.width || (typeof window !== "undefined" ? window.innerWidth : 1920));
      const screenHeight = Math.round(rect?.height || (typeof window !== "undefined" ? window.innerHeight : 1080));

      await downloadMosaicScreenshot({
        eventName: event.name,
        photos: effectiveWallPhotos,
        branding,
        maxPhotos: event.settings?.maxPhotos ?? 0,
        logoUrl: currentLogoUrl,
        autoFill: control.autoFill,
        stageIndex: activeTargetIndex,
        totalStages: numTargets,
        width: screenWidth,
        height: screenHeight,
      });
    } catch (err) {
      console.error("Screenshot capture failed:", err);
    } finally {
      setIsCapturingScreenshot(false);
    }
  }, [event, effectiveWallPhotos, branding, currentLogoUrl, control.autoFill, activeTargetIndex, numTargets, isCapturingScreenshot]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "s" || e.key === "S") && !e.ctrlKey && !e.metaKey && !e.altKey && (e.target === document.body || e.target === document.documentElement)) {
        void handleTakeScreenshot();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleTakeScreenshot]);

  if (!eventId) {
    return (
      <main className="screen-message">
        <ApertureMark className="screen-message__mark" />
        <p className="eyebrow">MOSAIC DISPLAY</p>
        <h1>Choose an event to begin.</h1>
        <p>Open the event link from the operator panel to connect this screen.</p>
        <a href="/admin" className="button button--accent">Open event controls</a>
      </main>
    );
  }

  if (!event && snapshotQuery.data === null) {
    return (
      <main className="screen-message">
        <ApertureMark className="screen-message__mark" />
        <p className="eyebrow">MOSAIC DISPLAY</p>
        <h1>We could not find that event.</h1>
        <p>Check the event link with the operator, then open the display again.</p>
        <a href="/admin" className="button button--accent">Open event controls</a>
      </main>
    );
  }

  if (!event && snapshotQuery.isError) {
    return (
      <main className="screen-message">
        <ApertureMark className="screen-message__mark" />
        <p className="eyebrow">MOSAIC DISPLAY</p>
        <h1>We cannot reach this event.</h1>
        <p>Check the network connection and try again.</p>
        <button type="button" className="button button--accent" onClick={() => void snapshotQuery.refetch()}>Try again</button>
      </main>
    );
  }

  if (!event && snapshotQuery.isLoading) {
    return <main className="mosaic-screen"><div className="mosaic-loading"><MosaicWordmark /><span>CONNECTING TO THE WALL</span></div></main>;
  }

  const flightTime = branding.animationSpeed === "calm" ? 1.4 : branding.animationSpeed === "energetic" ? 0.8 : 1.1;
  const holdSeconds = typeof branding.arrivalHoldDuration === "number" && branding.arrivalHoldDuration > 0
    ? branding.arrivalHoldDuration
    : (branding.animationSpeed === "calm" ? 3.5 : branding.animationSpeed === "energetic" ? 1.5 : 2.5);

  const screenStyle = {
    "--event-bg": branding.backgroundColor,
    "--event-primary": branding.primaryColor,
    "--event-accent": branding.accentColor,
    "--logo-scale": `${branding.logoScale}%`,
    "--inverted-logo-size": `${branding.logoScale || 48}%`,
    "--letters-logo-size": `${branding.logoScale || 85}%`,
    "--watermark-url": `url('${currentLogoUrl}')`,
    "--watermark-opacity": (branding.watermarkOpacity ?? (isLettersMode ? 100 : 60)) / 100,
    "--watermark-blend": branding.watermarkBlendMode ?? (isLettersMode ? "normal" : "overlay"),
    "--watermark-scale": `${branding.watermarkScale ?? 72}vmin`,
    "--watermark-position": (branding.watermarkPosition ?? "center").replace("-", " "),
    "--arrival-hold-duration": `${holdSeconds}s`,
    "--arrival-flight-duration": `${flightTime}s`,
  } as CSSProperties;

  return (
    <main className="mosaic-screen" data-theme={branding.theme} style={screenStyle}>
      {event ? (
        <MosaicWall
          photos={effectiveWallPhotos}
          arrivalId={arrivalId}
          animate={control.playing}
          autoFill={control.autoFill}
          branding={branding}
          maxPhotos={event.settings?.maxPhotos ?? 0}
          logoUrl={currentLogoUrl}
          onArrivalEnd={finishArrival}
        />
      ) : (
        <div className="mosaic-empty-grid" aria-hidden="true">{EMPTY_TILES.map(index => <span key={index} />)}</div>
      )}

      {control.screensaver && (
        <div className="mosaic-screen__screensaver-badge" aria-label="Wall is frozen">
          <span className="screensaver-dot" />
          <span>SCREENSAVER ACTIVE / تثبيت الشاشة</span>
        </div>
      )}

      {numTargets > 1 && (
        <div className="mosaic-stage-indicator" aria-label={`Stage ${activeTargetIndex + 1} of ${numTargets}`}>
          <span>STAGE {activeTargetIndex + 1} / {numTargets}</span>
          <div className="mosaic-stage-indicator__dots">
            {targetLogos.map((_, idx) => (
              <span
                key={idx}
                className={`mosaic-stage-dot ${idx === activeTargetIndex ? "mosaic-stage-dot--active" : idx < activeTargetIndex ? "mosaic-stage-dot--done" : ""}`}
                title={`Stage ${idx + 1}`}
              />
            ))}
          </div>
        </div>
      )}

      {event && (
        <div className={`mosaic-intro mosaic-intro--${branding.logoPosition}${branding.logoAnimation === "none" ? " mosaic-intro--none" : ""}${opening || ambientReveal ? " is-visible" : ""}${ambientReveal ? " mosaic-intro--ambient" : ""}`} aria-hidden={!opening && !ambientReveal}>
          <div className="mosaic-intro__mark">
            {currentLogoUrl ? <img src={currentLogoUrl} alt="" /> : <MosaicWordmark />}
          </div>
          <h1>{event.name}</h1>
          <p>{numTargets > 1 ? `STAGE ${activeTargetIndex + 1} OF ${numTargets}` : "EVERY MOMENT BECOMES PART OF THE ROOM"}</p>
        </div>
      )}

      {event && (
        <div className="mosaic-screen__caption" aria-live="polite">
          <span>{event.name} {numTargets > 1 ? `• TARGET ${activeTargetIndex + 1}/${numTargets}` : ""}</span>
          <span>{boardPhotos.length} {boardPhotos.length === 1 ? "MOMENT" : "MOMENTS"}{boardCapacity > 0 ? ` / ${boardCapacity}` : ""}</span>
        </div>
      )}

      {event && (
        <button
          type="button"
          className="mosaic-screenshot-btn"
          onClick={() => void handleTakeScreenshot()}
          disabled={isCapturingScreenshot}
          title="Download Wall Screenshot (Press 'S')"
          aria-label="Download Wall Screenshot"
        >
          <span>📸</span>
          <span>{isCapturingScreenshot ? "SAVING…" : "SCREENSHOT"}</span>
        </button>
      )}

      {!event && connection === "reconnecting" && (
        <div className="mosaic-loading"><MosaicWordmark /><span>CONNECTING TO THE WALL</span></div>
      )}
    </main>
  );
}
