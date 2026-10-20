import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Link } from "wouter";
import { z } from "zod";
import { ApertureMark, MosaicWordmark } from "../../components/MosaicBrand";
import { trpc } from "../../lib/trpc";
import {
  eventIdSchema,
  photoPayloadSchema,
  type PhotoPayload,
} from "../../../../shared/mosaic";
import { getOrCreateBoothId } from "../events/booth-id";
import { preparePhoto, type PreparedImage } from "./image";
import { addQueuedPhoto, getQueuedPhotos, makeQueuedPhoto, removeQueuedPhoto, type QueuedPhoto } from "./outbox";

interface CapturedPhoto {
  id: string;
  image: PreparedImage;
  localUrl: string;
}

type BoothStage = "ready" | "countdown" | "preview" | "uploading" | "confirmed" | "error";

interface BoothState {
  stage: BoothStage;
  countdown: number;
  error: string | null;
  photo: CapturedPhoto | null;
  savedPhotoUrl: string | null;
}

type BoothAction =
  | { type: "COUNTDOWN" }
  | { type: "TICK" }
  | { type: "CAPTURED"; photo: CapturedPhoto }
  | { type: "CAPTURE_FAILED"; message: string }
  | { type: "UPLOAD_STARTED" }
  | { type: "UPLOAD_FAILED"; message: string }
  | { type: "UPLOAD_SUCCEEDED"; imageUrl: string }
  | { type: "RETAKE" }
  | { type: "RESET" };

const initialBoothState: BoothState = {
  stage: "ready",
  countdown: 0,
  error: null,
  photo: null,
  savedPhotoUrl: null,
};

function boothReducer(state: BoothState, action: BoothAction): BoothState {
  switch (action.type) {
    case "COUNTDOWN": return { ...state, stage: "countdown", countdown: 3, error: null };
    case "TICK": return { ...state, countdown: Math.max(0, state.countdown - 1) };
    case "CAPTURED": return { ...state, stage: "preview", countdown: 0, photo: action.photo, error: null };
    case "CAPTURE_FAILED": return { ...state, stage: "ready", countdown: 0, error: action.message };
    case "UPLOAD_STARTED": return { ...state, stage: "uploading", error: null };
    case "UPLOAD_FAILED": return { ...state, stage: "error", error: action.message };
    case "UPLOAD_SUCCEEDED": return { ...state, stage: "confirmed", savedPhotoUrl: action.imageUrl, error: null };
    case "RETAKE": return { ...initialBoothState };
    case "RESET": return { ...initialBoothState };
  }
}

const uploadResponseSchema = z.object({ photo: photoPayloadSchema, duplicate: z.boolean() });
const uploadErrorSchema = z.object({ error: z.string().max(160).optional() });

function currentEventId(): string | null {
  const parsed = eventIdSchema.safeParse(new URLSearchParams(window.location.search).get("eventId"));
  return parsed.success ? parsed.data : null;
}

async function decodeResponse(response: Response, eventId: string): Promise<PhotoPayload> {
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new Error("The photo service returned an unreadable response"); }
  if (!response.ok) {
    const parsedError = uploadErrorSchema.safeParse(payload);
    throw new Error(parsedError.success && parsedError.data.error
      ? parsedError.data.error
      : "Photo upload failed. Keep this screen open and retry.");
  }
  const parsed = uploadResponseSchema.safeParse(payload);
  if (!parsed.success || parsed.data.photo.eventId !== eventId) {
    throw new Error("The photo service returned an invalid response");
  }
  return parsed.data.photo;
}

async function uploadQueuedPhoto(item: QueuedPhoto): Promise<PhotoPayload> {
  const body = new FormData();
  body.append("photoId", item.id);
  body.append("boothId", item.boothId);
  body.append("image", item.image, item.image.type === "image/jpeg" ? "capture.jpg" : "capture.png");
  const response = await fetch(`/api/events/${encodeURIComponent(item.eventId)}/photos`, {
    method: "POST",
    body,
    credentials: "include",
  });
  return decodeResponse(response, item.eventId);
}

export default function BoothPage() {
  const eventId = currentEventId();
  const [boothId] = useState(() => getOrCreateBoothId());
  const videoRef = useRef<HTMLVideoElement>(null);
  const currentPhotoRef = useRef<CapturedPhoto | null>(null);
  const [cameraState, setCameraState] = useState<"requesting" | "ready" | "error">("requesting");
  const [cameraMessage, setCameraMessage] = useState("");
  const [mirrorPreview, setMirrorPreview] = useState(true);
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [connection, setConnection] = useState<"connecting" | "online" | "reconnecting">("connecting");
  const [state, dispatch] = useReducer(boothReducer, initialBoothState);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const eventQuery = trpc.mosaic.publicEvent.useQuery(eventId ?? "invalid", {
    enabled: Boolean(eventId), retry: 1, refetchOnWindowFocus: false,
  });

  const event = eventQuery.data;
  const isLettersMode = event?.branding?.logoDisplayMode === "letters";

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const image = await preparePhoto(file);
      const photo: CapturedPhoto = {
        id: crypto.randomUUID(),
        image,
        localUrl: URL.createObjectURL(image.image),
      };
      currentPhotoRef.current = photo;
      dispatch({ type: "CAPTURED", photo });
    } catch (error: unknown) {
      dispatch({
        type: "CAPTURE_FAILED",
        message: error instanceof Error ? error.message : "The photo could not be prepared. Please try again.",
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  useEffect(() => {
    if (!eventId) return;
    let live = true;
    let stream: MediaStream | undefined;
    setCameraState("requesting");
    setCameraMessage("");

    const requestCamera = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser does not offer camera access.");
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "user" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (!live) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        const facingMode = stream.getVideoTracks()[0]?.getSettings().facingMode;
        setMirrorPreview(facingMode === "user" || !facingMode);
        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        if (live) setCameraState("ready");
      } catch (error: unknown) {
        if (!live) return;
        setCameraState("error");
        const message = error instanceof Error ? error.message : "Camera access is unavailable.";
        setCameraMessage(message.includes("Permission") || message.includes("denied")
          ? "Allow camera access in your browser, then try again."
          : message);
      }
    };

    void requestCamera();
    return () => {
      live = false;
      stream?.getTracks().forEach(track => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [eventId, cameraAttempt]);

  useEffect(() => {
    if (!eventId) return;
    const source = new EventSource(`/api/events/${encodeURIComponent(eventId)}/stream?boothId=${encodeURIComponent(boothId)}`);
    source.onopen = () => setConnection("online");
    source.onerror = () => setConnection("reconnecting");
    return () => source.close();
  }, [eventId, boothId]);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth < 1 || video.videoHeight < 1) {
      dispatch({ type: "CAPTURE_FAILED", message: "The camera is still starting. Try again in a moment." });
      return;
    }

    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("The camera image could not be captured on this device.");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const capturedBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("The camera image could not be captured.")), "image/jpeg", 0.94);
      });

      const image = await preparePhoto(capturedBlob);
      const photo: CapturedPhoto = {
        id: crypto.randomUUID(),
        image,
        localUrl: URL.createObjectURL(image.image),
      };
      currentPhotoRef.current = photo;
      dispatch({ type: "CAPTURED", photo });
    } catch (error: unknown) {
      dispatch({
        type: "CAPTURE_FAILED",
        message: error instanceof Error ? error.message : "The photo could not be prepared. Please try again.",
      });
    }
  }, []);

  useEffect(() => {
    if (state.stage !== "countdown") return;
    const timer = window.setTimeout(() => {
      if (state.countdown <= 1) void capture();
      else dispatch({ type: "TICK" });
    }, 950);
    return () => window.clearTimeout(timer);
  }, [state.stage, state.countdown, capture]);

  useEffect(() => {
    if (state.photo?.localUrl) {
      currentPhotoRef.current = state.photo;
      return () => URL.revokeObjectURL(state.photo!.localUrl);
    }
    currentPhotoRef.current = null;
  }, [state.photo]);

  const sendPhoto = useCallback(async (photo: CapturedPhoto) => {
    if (!eventId) return;
    dispatch({ type: "UPLOAD_STARTED" });
    const queued = makeQueuedPhoto(photo.id, eventId, boothId, photo.image);
    try { await addQueuedPhoto(queued); } catch { /* The in-memory photo remains retryable on this kiosk. */ }
    try {
      const saved = await uploadQueuedPhoto(queued);
      await removeQueuedPhoto(photo.id).catch(() => undefined);
      dispatch({ type: "UPLOAD_SUCCEEDED", imageUrl: saved.imageUrl });
    } catch (error: unknown) {
      dispatch({
        type: "UPLOAD_FAILED",
        message: error instanceof Error ? error.message : "Photo upload failed. Reconnect and retry.",
      });
    }
  }, [eventId, boothId]);

  const flushQueue = useCallback(async () => {
    if (!eventId) return;
    try {
      const queued = await getQueuedPhotos(eventId);
      for (const item of queued) {
        try {
          const saved = await uploadQueuedPhoto(item);
          await removeQueuedPhoto(item.id);
          if (currentPhotoRef.current?.id === item.id) {
            dispatch({ type: "UPLOAD_SUCCEEDED", imageUrl: saved.imageUrl });
          }
        } catch {
          break;
        }
      }
    } catch {
      // IndexedDB can be disabled; current captures remain in component state.
    }
  }, [eventId]);

  useEffect(() => {
    const retry = () => { void flushQueue(); };
    window.addEventListener("online", retry);
    void flushQueue();
    return () => window.removeEventListener("online", retry);
  }, [flushQueue]);

  useEffect(() => {
    if (state.stage !== "confirmed") return;
    const timer = window.setTimeout(() => dispatch({ type: "RESET" }), 4_500);
    return () => window.clearTimeout(timer);
  }, [state.stage]);

  useEffect(() => () => {
    if (currentPhotoRef.current) URL.revokeObjectURL(currentPhotoRef.current.localUrl);
  }, []);

  const retake = () => {
    const photoId = state.photo?.id;
    if (photoId) void removeQueuedPhoto(photoId).catch(() => undefined);
    currentPhotoRef.current = null;
    dispatch({ type: "RETAKE" });
  };

  if (!eventId) {
    return (
      <main className="screen-message">
        <ApertureMark className="screen-message__mark" />
        <p className="eyebrow">PHOTO BOOTH</p>
        <h1>This booth needs an event link.</h1>
        <p>Ask the operator to open a booth link from the event controls.</p>
        <Link href="/admin" className="button button--accent">Open operator controls</Link>
      </main>
    );
  }

  if (eventQuery.isLoading) {
    return <main className="screen-message"><MosaicWordmark /><p>CONNECTING TO THE EVENT</p></main>;
  }
  if (!eventQuery.data) {
    return (
      <main className="screen-message">
        <ApertureMark className="screen-message__mark" />
        <p className="eyebrow">EVENT LINK</p>
        <h1>This event is unavailable.</h1>
        <p>Check the event link with the operator before capturing.</p>
      </main>
    );
  }

  const qrValue = event ? `${window.location.origin}/gallery/${encodeURIComponent(event.id)}?photo=${encodeURIComponent(state.photo?.id ?? "")}` : "";
  const isPreview = state.stage === "preview" || state.stage === "uploading" || state.stage === "error";

  return (
    <main className={`booth-screen booth-screen--${state.stage}`}>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFileUpload} />
      <video ref={videoRef} className={`booth-camera${mirrorPreview ? " booth-camera--mirrored" : ""}`} autoPlay muted playsInline aria-label="Live camera preview" />
      {isLettersMode && cameraState === "ready" && (state.stage === "ready" || state.stage === "countdown") && (
        <div className="booth-letters-guide" aria-hidden="true">
          <div className="booth-letters-guide__band">
            <span>HAYAH SHARKS • POSITION FACE HERE</span>
          </div>
        </div>
      )}
      <div className="booth-screen__shade" />
      <header className="booth-header">
        <MosaicWordmark compact />
        <div className="booth-live-state" aria-live="polite">
          <span className={`status-dot ${connection === "online" ? "status-dot--live" : "status-dot--quiet"}`} />
          <span>{connection === "online" ? "CONNECTED" : "RECONNECTING"}</span>
        </div>
      </header>

      {cameraState !== "ready" && (
        <section className="camera-notice" aria-live="polite">
          <ApertureMark className="camera-notice__mark" />
          <p className="eyebrow">{cameraState === "requesting" ? "PREPARING THE CAMERA" : "CAMERA NEEDED"}</p>
          <h1>{cameraState === "requesting" ? "One moment." : "Ready when you are."}</h1>
          <p>{cameraState === "requesting" ? "Allow camera access to begin." : cameraMessage}</p>
          {cameraState === "error" && (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
              <button className="button button--accent" type="button" onClick={() => setCameraAttempt(value => value + 1)}>
                TRY CAMERA AGAIN
              </button>
              <button className="button button--quiet" type="button" onClick={() => fileInputRef.current?.click()}>
                CHOOSE PHOTO FROM LIBRARY
              </button>
            </div>
          )}
        </section>
      )}

      {cameraState === "ready" && state.stage === "ready" && (
        <section className="booth-ready" aria-label="Take a photo">
          <p className="eyebrow">A LITTLE MOMENT, A BIGGER PICTURE</p>
          <h1>READY<span>?</span></h1>
          <button className="booth-shutter" type="button" onClick={() => dispatch({ type: "COUNTDOWN" })}>
            <span className="booth-shutter__icon"><ApertureMark /></span>
            <span>TAKE PHOTO</span>
          </button>
          <button
            className="button button--quiet"
            type="button"
            style={{ marginTop: "0.5rem", fontSize: "0.85rem", opacity: 0.85 }}
            onClick={() => fileInputRef.current?.click()}
          >
            CHOOSE PHOTO FROM LIBRARY
          </button>
          <p className="booth-hint">Look into the camera. The wall is waiting.</p>
        </section>
      )}

      {state.stage === "countdown" && (
        <div className="booth-countdown" aria-live="assertive" aria-atomic="true" key={state.countdown}>
          <span>{state.countdown}</span>
        </div>
      )}

      {isPreview && state.photo && (
        <section className="booth-review" aria-label="Review your photo">
          <div className="booth-review__image-wrap">
            <img className="booth-review__image" src={state.photo.localUrl} alt="Your captured photo" />
            <span className="booth-review__frame" aria-hidden="true" />
          </div>
          <div className="booth-review__copy">
            <p className="eyebrow">A MOMENT WORTH KEEPING</p>
            <h1>{state.stage === "error" ? "Try that again." : "Make it part of the wall."}</h1>
            {state.error && <p className="booth-error" role="alert">{state.error}</p>}
            {state.stage === "uploading" ? (
              <p className="booth-upload-state" role="status"><span className="loading-ring" />Sending your photo to the wall…</p>
            ) : (
              <div className="booth-review__actions">
                <button className="button button--quiet" type="button" onClick={retake}>RETAKE</button>
                <button
                  className="button button--accent"
                  type="button"
                  onClick={() => void sendPhoto(state.photo!)}
                >
                  {state.stage === "error" ? "RETRY UPLOAD" : "USE PHOTO"}
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {state.stage === "confirmed" && state.photo && (
        <section className="booth-confirmation" aria-live="polite">
          <div className="booth-confirmation__photo"><img src={state.photo.localUrl} alt="Your photo" /></div>
          <div className="booth-confirmation__copy">
            <p className="eyebrow">THE WALL JUST GOT A LITTLE BIGGER</p>
            <h1>{event.settings.boothMessage}</h1>
            <p>Your moment is joining the Mosaic.</p>
            {event.settings.showGuestQr && (
              <div className="booth-qr">
                <QRCodeSVG value={qrValue} size={112} level="M" bgColor="transparent" fgColor="#f7f2ea" aria-label="Scan to view your event photo" />
                <span>SCAN TO GET YOUR PHOTO</span>
              </div>
            )}
          </div>
        </section>
      )}

      <footer className="booth-footer">
        <span>{event.name}</span>
        <span>{state.stage === "confirmed" ? "THANK YOU FOR BEING PART OF IT" : "YOUR PHOTO, PART OF THE ROOM"}</span>
      </footer>
    </main>
  );
}
