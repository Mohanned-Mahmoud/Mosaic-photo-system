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
import { appendUniquePhoto, getUnseenSnapshotPhotos } from "./mosaic-state";

const EMPTY_TILES = Array.from({ length: 500 }, (_, index) => index);

const controlMessageSchema = mosaicControlSchema.extend({
  action: z.enum(["play", "pause", "restart", "clear", "reset"]),
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
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [photos, setPhotos] = useState<PhotoPayload[]>([]);
  const [control, setControl] = useState<MosaicControl>({ playing: true, revision: 0, restartKey: 0 });
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
  const lastSnapshotSignature = useRef("");
  const controlRef = useRef(control);

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
      setOpening(true);
    } else if (priorRestartKey.current !== next.control.restartKey) {
      priorRestartKey.current = next.control.restartKey;
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
  }, [opening, control.restartKey]);

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
      if (action === "restart" || action === "reset") setOpening(true);
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

  const branding = event?.branding ?? EMPTY_BRANDING;
  const animationDuration = branding.animationSpeed === "calm" ? "2s" : branding.animationSpeed === "energetic" ? ".95s" : "1.45s";
  const screenStyle = {
    "--event-bg": branding.backgroundColor,
    "--event-primary": branding.primaryColor,
    "--event-accent": branding.accentColor,
    "--logo-scale": `${branding.logoScale}%`,
    "--watermark-url": `url('${event?.logoUrl || defaultLogo}')`,
    "--watermark-opacity": (branding.watermarkOpacity ?? 60) / 100,
    "--watermark-blend": branding.watermarkBlendMode ?? "overlay",
    "--watermark-scale": `${branding.watermarkScale ?? 72}vmin`,
    "--watermark-position": (branding.watermarkPosition ?? "center").replace("-", " "),
    "--arrival-duration": animationDuration,
  } as CSSProperties;

  return (
    <main className="mosaic-screen" data-theme={branding.theme} style={screenStyle}>
      {event ? (
        <MosaicWall
          photos={photos}
          arrivalId={arrivalId}
          animate={control.playing}
          branding={branding}
          maxPhotos={event.settings?.maxPhotos ?? 0}
          onArrivalEnd={finishArrival}
        />
      ) : (
        <div className="mosaic-empty-grid" aria-hidden="true">{EMPTY_TILES.map(index => <span key={index} />)}</div>
      )}



      {event && (
        <div className={`mosaic-intro mosaic-intro--${branding.logoPosition}${branding.logoAnimation === "none" ? " mosaic-intro--none" : ""}${opening || ambientReveal ? " is-visible" : ""}${ambientReveal ? " mosaic-intro--ambient" : ""}`} aria-hidden={!opening && !ambientReveal}>
          <div className="mosaic-intro__mark">
            {event.logoUrl ? <img src={event.logoUrl} alt="" /> : <MosaicWordmark />}
          </div>
          <h1>{event.name}</h1>
          <p>EVERY MOMENT BECOMES PART OF THE ROOM</p>
        </div>
      )}

      {event && photos.length > 0 && (
        <div className="mosaic-screen__caption" aria-live="polite">
          <span>{event.name}</span>
          <span>{photos.length} {photos.length === 1 ? "MOMENT" : "MOMENTS"}</span>
        </div>
      )}
      {!event && connection === "reconnecting" && (
        <div className="mosaic-loading"><MosaicWordmark /><span>CONNECTING TO THE WALL</span></div>
      )}
    </main>
  );
}
