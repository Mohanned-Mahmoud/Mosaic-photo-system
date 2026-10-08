import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { ChangeEvent } from "react";
import { Link } from "wouter";
import { ApertureMark, MosaicWordmark } from "../../components/MosaicBrand";
import { trpc } from "../../lib/trpc";
import {
  createEventInputSchema,
  DEFAULT_BRANDING,
  eventBrandingSchema,
  type EventBranding,
  DEFAULT_EVENT_SETTINGS,
  eventSettingsSchema,
  type EventSettings,
} from "../../../../shared/mosaic";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Logo could not be read"));
    reader.onerror = () => reject(new Error("Logo could not be read"));
    reader.readAsDataURL(file);
  });
}

export default function AdminPage() {
  const utils = trpc.useUtils();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const eventsQuery = trpc.mosaic.listEvents.useQuery(undefined, {
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const events = eventsQuery.data ?? [];

  useEffect(() => {
    if (!selectedEventId && events[0]) setSelectedEventId(events[0].id);
    if (selectedEventId && !events.some(event => event.id === selectedEventId)) setSelectedEventId(events[0]?.id ?? null);
  }, [events, selectedEventId]);

  const dashboardQuery = trpc.mosaic.dashboard.useQuery(selectedEventId ?? "invalid", {
    enabled: Boolean(selectedEventId),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
  const createForm = useForm<{ name: string }>({
    resolver: zodResolver(createEventInputSchema),
    defaultValues: { name: "" },
  });
  const brandingForm = useForm<EventBranding>({
    resolver: zodResolver(eventBrandingSchema),
    defaultValues: DEFAULT_BRANDING,
  });
  const settingsForm = useForm<EventSettings>({
    resolver: zodResolver(eventSettingsSchema),
    defaultValues: DEFAULT_EVENT_SETTINGS,
  });

  const createEvent = trpc.mosaic.create.useMutation({
    onSuccess: async created => {
      await utils.mosaic.listEvents.invalidate();
      setSelectedEventId(created.id);
      createForm.reset({ name: "" });
      setNotice("Event created. Share the booth link to begin.");
    },
    onError: error => setNotice(error.message),
  });
  const updateEvent = trpc.mosaic.update.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.mosaic.listEvents.invalidate(), utils.mosaic.dashboard.invalidate()]);
      setNotice("Event branding saved.");
    },
    onError: error => setNotice(error.message),
  });
  const uploadLogo = trpc.mosaic.uploadLogo.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.mosaic.listEvents.invalidate(), utils.mosaic.dashboard.invalidate()]);
      setNotice("Event logo updated.");
    },
    onError: error => setNotice(error.message),
  });
  const controlEvent = trpc.mosaic.control.useMutation({
    onSuccess: async () => {
      await utils.mosaic.dashboard.invalidate();
      setNotice("Mosaic control updated.");
    },
    onError: error => setNotice(error.message),
  });
  const hidePhoto = trpc.mosaic.hidePhoto.useMutation({
    onSuccess: async () => {
      await utils.mosaic.dashboard.invalidate();
      setNotice("Photo hidden from the Mosaic and public gallery. Stored image bytes are retained.");
    },
    onError: error => setNotice(error.message),
  });
  const unhidePhoto = trpc.mosaic.unhidePhoto.useMutation({
    onSuccess: async () => {
      await utils.mosaic.dashboard.invalidate();
      setNotice("Photo unhidden. It will appear in the gallery and Mosaic again.");
    },
    onError: error => setNotice(error.message),
  });

  const event = dashboardQuery.data?.event;
  useEffect(() => {
    if (event) {
      brandingForm.reset(event.branding);
      settingsForm.reset(event.settings);
    }
  }, [event?.id, brandingForm, settingsForm]);

  const uploadEventLogo = async (change: ChangeEvent<HTMLInputElement>) => {
    const file = change.target.files?.[0];
    change.target.value = "";
    if (!file || !selectedEventId) return;
    const mimeType = file.type === "image/png" ? "image/png" : file.type === "image/svg+xml" ? "image/svg+xml" : null;
    if (!mimeType || file.size > 1_000_000) {
      setNotice("Choose a transparent PNG or safe SVG logo smaller than 1 MB.");
      return;
    }
    try {
      uploadLogo.mutate({ eventId: selectedEventId, dataUrl: await fileToDataUrl(file), mimeType });
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "Logo could not be read");
    }
  };

  const eventLinks = selectedEventId ? {
    booth: `/booth?eventId=${encodeURIComponent(selectedEventId)}`,
    mosaic: `/mosaic?eventId=${encodeURIComponent(selectedEventId)}`,
    gallery: `/gallery/${encodeURIComponent(selectedEventId)}`,
  } : null;

  const copyLink = async (path: string) => {
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
      setNotice("Event link copied.");
    } catch {
      setNotice("Copy was unavailable. Open the link directly from this panel.");
    }
  };

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <Link href="/" aria-label="Mosaic home"><MosaicWordmark compact /></Link>
        <div className="admin-topbar__right">
          <span className="operator-label">PUBLIC EVENT CONTROLS</span>
        </div>
      </header>

      <section className="admin-heading">
        <div>
          <p className="eyebrow">THE MOMENTS, IN MOTION</p>
          <h1>Event control.</h1>
          <p className="admin-heading__lede">Set the room. Open the wall. Let the guests make it theirs.</p>
        </div>
        <div className="admin-heading__mark"><ApertureMark /></div>
      </section>

      {notice && <div className="admin-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss notice" onClick={() => setNotice(null)}>×</button></div>}

      <aside className="admin-public-warning" role="alert">
        <strong>PUBLIC CONTROLS</strong>
        <span>Anyone with this page can create events, edit branding, upload logos, pause or reset any wall, and hide photos. Guest photo-upload links, active event names, and galleries are public too. Share booth/gallery links—not this page—with attendees.</span>
      </aside>

      <section className="admin-event-setup" aria-labelledby="event-setup-title">
        <div className="admin-section-heading">
          <div><p className="eyebrow">01 / EVENT</p><h2 id="event-setup-title">Choose a room.</h2></div>
          <span className="subtle-count">{events.length.toString().padStart(2, "0")} EVENTS</span>
        </div>
        <div className="admin-event-setup__row">
          <label className="field-label" htmlFor="event-select">CURRENT EVENT</label>
          <select id="event-select" className="field-select" value={selectedEventId ?? ""} onChange={eventChange => setSelectedEventId(eventChange.target.value || null)}>
            <option value="">Select an event</option>
            {events.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <form className="new-event-form" onSubmit={createForm.handleSubmit(values => createEvent.mutate(values))}>
            <input className="field-input" aria-label="New event name" placeholder="Name a new event" {...createForm.register("name")} />
            <button className="button button--accent" type="submit" disabled={createEvent.isPending}>CREATE EVENT</button>
          </form>
        </div>
        {createForm.formState.errors.name && <p className="field-error" role="alert">{createForm.formState.errors.name.message}</p>}
      </section>

      {!selectedEventId && !eventsQuery.isLoading && (
        <section className="admin-empty-state">
          <span className="admin-empty-state__index">A / 00</span>
          <h2>Every wall starts somewhere.</h2>
          <p>Create an event to open its booth, live screen, and guest gallery.</p>
        </section>
      )}

      {selectedEventId && event && dashboardQuery.data && eventLinks && (
        <>
          <section className="admin-live-strip" aria-live="polite">
            <div><span className="status-dot status-dot--live" /><span>EVENT ACTIVE</span></div>
            <div><strong>{dashboardQuery.data.photoCount.toLocaleString()}</strong><span>PHOTOS</span></div>
            <div><strong>{dashboardQuery.data.connectedBooths}</strong><span>CONNECTED BOOTHS</span></div>
            <Link href={eventLinks.mosaic} target="_blank" rel="noreferrer" className="button button--quiet">OPEN MOSAIC ↗</Link>
          </section>

          <section className="admin-columns">
            <div className="admin-panel admin-panel--branding">
              <div className="admin-section-heading">
                <div><p className="eyebrow">02 / IDENTITY</p><h2>Set the scene.</h2></div>
              </div>
              <div className="event-logo-editor">
                <div className="event-logo-editor__preview">
                  {event.logoUrl ? <img src={event.logoUrl} alt="Current event logo" /> : <ApertureMark />}
                </div>
                <div>
                  <label className="button button--quiet" htmlFor="event-logo-input">{uploadLogo.isPending ? "UPLOADING…" : "UPLOAD EVENT LOGO"}</label>
                  <input id="event-logo-input" className="visually-hidden" type="file" accept="image/png,image/svg+xml,.svg" onChange={eventLogoChange => void uploadEventLogo(eventLogoChange)} />
                  <p>Transparent PNG or SVG · under 1 MB</p>
                </div>
              </div>
              <form className="branding-form" onSubmit={brandingForm.handleSubmit(branding => updateEvent.mutate({ eventId: selectedEventId, branding }))}>
                <label className="field-label">EVENT NAME
                  <input className="field-input" maxLength={100} defaultValue={event.name} key={`${event.id}-${event.name}`} onBlur={nameChange => {
                    const name = nameChange.currentTarget.value.trim();
                    if (name.length >= 2 && name !== event.name) updateEvent.mutate({ eventId: selectedEventId, name });
                  }} />
                </label>
                <div className="branding-form__colors">
                  <label className="field-label">PRIMARY COLOR<input className="field-color" type="color" {...brandingForm.register("primaryColor")} /></label>
                  <label className="field-label">ACCENT COLOR<input className="field-color" type="color" {...brandingForm.register("accentColor")} /></label>
                  <label className="field-label">BACKGROUND<input className="field-color" type="color" {...brandingForm.register("backgroundColor")} /></label>
                </div>
                <div className="branding-form__row">
                  <label className="field-label">TILE GAP (PX)<input className="field-input" type="number" min={0} max={16} {...brandingForm.register("tileGap", { valueAsNumber: true })} /></label>
                  <label className="field-label">LOGO SCALE (%)<input className="field-input" type="number" min={30} max={100} {...brandingForm.register("logoScale", { valueAsNumber: true })} /></label>
                </div>
                <div className="branding-form__row">
                  <label className="field-label">MOTION SPEED
                    <select className="field-select" {...brandingForm.register("animationSpeed")}><option value="calm">Calm</option><option value="cinematic">Cinematic</option><option value="energetic">Energetic</option></select>
                  </label>
                  <label className="field-label">LOGO POSITION
                    <select className="field-select" {...brandingForm.register("logoPosition")}><option value="center">Center</option><option value="top-left">Top left</option><option value="top-right">Top right</option></select>
                  </label>
                </div>
                <div className="branding-form__row">
                  <label className="field-label">WATERMARK OPACITY (%)
                    <input className="field-input" type="number" min={0} max={100} {...brandingForm.register("watermarkOpacity", { valueAsNumber: true })} />
                  </label>
                  <label className="field-label">WATERMARK BLEND
                    <select className="field-select" {...brandingForm.register("watermarkBlendMode")}>
                      <option value="overlay">Overlay (Best for dark)</option>
                      <option value="multiply">Multiply (Best for light)</option>
                      <option value="screen">Screen</option>
                      <option value="soft-light">Soft light</option>
                      <option value="hard-light">Hard light</option>
                      <option value="normal">Normal</option>
                    </select>
                  </label>
                </div>
                <div className="branding-form__row">
                  <label className="field-label">WATERMARK SCALE (%)
                    <input className="field-input" type="number" min={10} max={200} {...brandingForm.register("watermarkScale", { valueAsNumber: true })} />
                  </label>
                  <label className="field-label">WATERMARK POSITION
                    <select className="field-select" {...brandingForm.register("watermarkPosition")}>
                      <option value="center">Center</option>
                      <option value="top-left">Top left</option>
                      <option value="top-right">Top right</option>
                      <option value="bottom-left">Bottom left</option>
                      <option value="bottom-right">Bottom right</option>
                    </select>
                  </label>
                </div>
                <div className="branding-form__row">
                  <label className="field-label">LOGO MOMENT
                    <select className="field-select" {...brandingForm.register("logoAnimation")}><option value="reveal">Cinematic reveal</option><option value="none">No logo animation</option></select>
                  </label>
                  <label className="field-label">WALL THEME
                    <select className="field-select" {...brandingForm.register("theme")}><option value="dark">Ink dark</option><option value="light">Warm light</option></select>
                  </label>
                </div>
                <button className="button button--accent" type="submit" disabled={updateEvent.isPending}>SAVE BRANDING</button>
              </form>
            </div>

            <div className="admin-panel admin-panel--operations">
              <div className="admin-section-heading"><div><p className="eyebrow">03 / LIVE WALL</p><h2>Run the room.</h2></div></div>
              
              <form className="branding-form" onSubmit={settingsForm.handleSubmit((settings: EventSettings) => updateEvent.mutate({ eventId: selectedEventId, settings: { ...settings, showGuestQr: String(settings.showGuestQr) === 'true' } }))}>
                <div className="branding-form__row">
                  <label className="field-label">GRID SIZE (MAX PHOTOS)
                    <select className="field-select" {...settingsForm.register("maxPhotos", { valueAsNumber: true })}>
                      <option value={0}>Unlimited (Auto Grid)</option>
                      <option value={15}>15 Photos (5×3)</option>
                      <option value={28}>28 Photos (7×4)</option>
                      <option value={45}>45 Photos (9×5)</option>
                      <option value={66}>66 Photos (11×6)</option>
                      <option value={84}>84 Photos (12×7)</option>
                      <option value={112}>112 Photos (14×8)</option>
                      <option value={144}>144 Photos (16×9)</option>
                      <option value={180}>180 Photos (18×10)</option>
                      <option value={252}>252 Photos (21×12)</option>
                    </select>
                  </label>
                  <label className="field-label">SHOW QR CODE ON SCREEN
                    <select className="field-select" {...settingsForm.register("showGuestQr")}>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  </label>
                </div>
                <div className="branding-form__row">
                  <label className="field-label">PHOTO BOOTH MESSAGE
                    <input className="field-input" type="text" maxLength={80} {...settingsForm.register("boothMessage")} />
                  </label>
                </div>
                <button className="button button--quiet" type="submit" disabled={updateEvent.isPending} style={{ minWidth: 155, justifySelf: 'start' }}>SAVE SETTINGS</button>
              </form>

              <div className="control-console" aria-label="Mosaic playback controls">
                <button className="control-button" type="button" onClick={() => controlEvent.mutate({ eventId: selectedEventId, action: dashboardQuery.data.control.playing ? "pause" : "play" })}>
                  <span>{dashboardQuery.data.control.playing ? "Ⅱ" : "▶"}</span>{dashboardQuery.data.control.playing ? "PAUSE" : "PLAY"}
                </button>
                <button className="control-button" type="button" onClick={() => controlEvent.mutate({ eventId: selectedEventId, action: "restart" })}>
                  <span>↺</span>RESTART
                </button>
                <button className="control-button control-button--clear" type="button" onClick={() => controlEvent.mutate({ eventId: selectedEventId, action: "clear" })}>
                  <span>⌫</span>CLEAR WALL
                </button>
                <p>Clearing resets only the live wall. Stored photos remain in the event gallery.</p>
              </div>

              <div className="admin-links">
                <a href={eventLinks.booth} target="_blank" rel="noreferrer"><span>01</span><span>Photo booth link</span><span>↗</span></a>
                <a href={eventLinks.mosaic} target="_blank" rel="noreferrer"><span>02</span><span>Fullscreen Mosaic</span><span>↗</span></a>
                <a href={eventLinks.gallery} target="_blank" rel="noreferrer"><span>03</span><span>Guest gallery</span><span>↗</span></a>
              </div>
              <div className="admin-copy-actions">
                <button className="text-button" type="button" onClick={() => void copyLink(eventLinks.booth)}>COPY BOOTH LINK</button>
                <button className="text-button" type="button" onClick={() => void copyLink(eventLinks.mosaic)}>COPY MOSAIC LINK</button>
              </div>
              <div className="admin-booths">
                <div className="admin-subheading"><span>BOOTH DEVICES</span><span>{dashboardQuery.data.connectedBooths} CONNECTED NOW</span></div>
                {dashboardQuery.data.booths.length === 0 ? <p className="empty-line">No booth has connected yet.</p> : (
                  <ul>{dashboardQuery.data.booths.slice(0, 8).map((booth: any) => <li key={booth.id}><span className="status-dot status-dot--quiet" /><code>{booth.id.slice(0, 8).toUpperCase()}</code><time>{new Date(booth.lastSeenAt).toLocaleTimeString()}</time></li>)}</ul>
                )}
              </div>
            </div>
          </section>

          <section className="admin-photos" aria-labelledby="photo-moderation-title">
            <div className="admin-section-heading">
              <div><p className="eyebrow">04 / MOMENTS</p><h2 id="photo-moderation-title">The latest photographs.</h2></div>
              <Link href={eventLinks.gallery} className="text-button">OPEN GUEST GALLERY ↗</Link>
            </div>
            {dashboardQuery.data.photos.length === 0 ? (
              <div className="admin-photo-empty"><span>THE WALL IS WAITING</span><p>Open a booth link to bring the first photo into this room.</p></div>
            ) : (
              <div className="admin-photo-grid">
                {dashboardQuery.data.photos.map(photo => (
                  <figure className={`admin-photo ${photo.isHidden ? 'admin-photo--hidden' : ''}`} key={photo.id}>
                    <img src={photo.thumbnailUrl} alt="Guest-submitted event photo" loading="lazy" decoding="async" />
                    {photo.isHidden && <div className="admin-photo__hidden-badge">HIDDEN</div>}
                    <figcaption>
                      <time>{new Date(photo.createdAt).toLocaleTimeString()}</time>
                      {photo.isHidden ? (
                        <button type="button" onClick={() => unhidePhoto.mutate({ eventId: selectedEventId, photoId: photo.id })} disabled={unhidePhoto.isPending}>SHOW</button>
                      ) : (
                        <button type="button" onClick={() => hidePhoto.mutate({ eventId: selectedEventId, photoId: photo.id })} disabled={hidePhoto.isPending}>HIDE</button>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
            <p className="admin-retention-note">HIDE removes a photo from the live wall and guest gallery. The stored image bytes are retained.</p>
          </section>

          <section className="admin-reset-row">
            <div><p className="eyebrow">END OF SESSION</p><p>Reset begins a fresh wall and plays the opening again. Photos remain stored.</p></div>
            <button className="button button--quiet" type="button" onClick={() => controlEvent.mutate({ eventId: selectedEventId, action: "reset" })}>RESET EVENT SESSION</button>
          </section>
        </>
      )}

      {selectedEventId && dashboardQuery.isLoading && <div className="admin-loading">LOADING EVENT CONTROL…</div>}
      {eventsQuery.isError && <p className="field-error" role="alert">Events could not be loaded. Refresh the page to retry.</p>}
    </main>
  );
}
