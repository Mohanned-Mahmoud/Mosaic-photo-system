import { useEffect, useState, Suspense, lazy } from "react";
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
import { downloadMosaicScreenshot } from "../mosaic/mosaic-screenshot";

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function uploadLogoFileDirectly(
  eventId: string,
  file: File,
  append: boolean,
  onProgress: (percent: number, loaded: number, total: number) => void,
): Promise<{ success: boolean; event: any; url: string }> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("append", append ? "true" : "false");

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/events/${eventId}/logo`);

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && evt.total > 0) {
        const percent = Math.min(94, Math.round((evt.loaded / evt.total) * 94));
        onProgress(Math.max(3, percent), evt.loaded, evt.total);
      }
    };

    xhr.upload.onload = () => {
      onProgress(95, file.size, file.size);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const resp = JSON.parse(xhr.responseText);
          resolve(resp);
        } catch {
          resolve({ success: true, event: null, url: "" });
        }
      } else {
        let msg = "فشل في رفع ملف اللوجو";
        try {
          const resp = JSON.parse(xhr.responseText);
          if (resp.error) msg = resp.error;
        } catch {}
        reject(new Error(msg));
      }
    };

    xhr.onerror = () => {
      reject(new Error("تعذر الاتصال بالسيرفر أثناء عملية الرفع"));
    };

    xhr.ontimeout = () => {
      reject(new Error("انتهت مهلة الرفع، يرجى المحاولة مرة أخرى"));
    };

    xhr.send(formData);
  });
}

const MosaicMaskEditor = lazy(() => import("./MosaicMaskEditor"));

export default function AdminPage() {
  const utils = trpc.useUtils();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [isMaskEditorOpen, setIsMaskEditorOpen] = useState(false);
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
  const selectedLogoDisplayMode = brandingForm.watch("logoDisplayMode") ?? "watermark";

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
  const deleteEvent = trpc.mosaic.deleteEvent.useMutation({
    onSuccess: async () => {
      await utils.mosaic.listEvents.invalidate();
      setSelectedEventId(null);
      setNotice("Event permanently deleted.");
    },
    onError: error => setNotice(error.message),
  });
  const deletePhoto = trpc.mosaic.deletePhoto.useMutation({
    onSuccess: async () => {
      await utils.mosaic.dashboard.invalidate();
      setNotice("Photo permanently deleted from disk and database.");
    },
    onError: error => setNotice(error.message),
  });

  const event = dashboardQuery.data?.event;
  const targetLogos: string[] = event?.branding?.targetLogos && event.branding.targetLogos.length > 0
    ? event.branding.targetLogos
    : (event?.logoUrl ? [event.logoUrl] : []);
  const currentControlTargetIndex = dashboardQuery.data
    ? (dashboardQuery.data.control.targetIndex ?? 0) % Math.max(1, targetLogos.length)
    : 0;

  const [uploadProgress, setUploadProgress] = useState<{
    active: boolean;
    percent: number;
    statusText: string;
    fileName: string;
    fileSizeFormatted: string;
    isError?: boolean;
  }>({
    active: false,
    percent: 0,
    statusText: "",
    fileName: "",
    fileSizeFormatted: "",
    isError: false,
  });

  useEffect(() => {
    if (event) {
      const activeTargets = event.branding?.targetLogos && event.branding.targetLogos.length > 0
        ? event.branding.targetLogos
        : (event.logoUrl ? [event.logoUrl] : []);
      brandingForm.reset({
        ...DEFAULT_BRANDING,
        ...event.branding,
        autoAdvance: event.branding.autoAdvance ?? true,
        autoAdvanceDelay: event.branding.autoAdvanceDelay ?? 5,
        arrivalHoldDuration: event.branding.arrivalHoldDuration ?? 3,
        targetLogos: activeTargets,
        logoDisplayMode: event.branding.logoDisplayMode ?? "watermark",
        lettersMode: event.branding.lettersMode ?? "grid",
      });
      settingsForm.reset(event.settings);
    }
  }, [event?.id, event?.branding?.targetLogos?.length, event?.branding?.lettersMode, event?.branding?.logoDisplayMode, event?.branding?.arrivalHoldDuration, event?.logoUrl, brandingForm, settingsForm]);

  const currentLettersMode = brandingForm.watch("lettersMode") ?? event?.branding?.lettersMode ?? "grid";

  const handleSetLettersMode = (mode: "grid" | "dense" | "strip") => {
    if (!selectedEventId || !event) return;
    brandingForm.setValue("lettersMode", mode);
    updateEvent.mutate({
      eventId: selectedEventId,
      branding: {
        ...event.branding,
        ...brandingForm.getValues(),
        lettersMode: mode,
      },
    });
  };

  const uploadEventLogo = async (change: ChangeEvent<HTMLInputElement>, append = false) => {
    const file = change.target.files?.[0];
    change.target.value = "";
    if (!file || !selectedEventId) return;

    if (file.size > 200_000_000) {
      setNotice("الملف كبير جداً (أكثر من 200 ميجابايت). الرجاء اختيار ملف أصغر.");
      return;
    }

    const fileSizeStr = formatBytes(file.size);
    setUploadProgress({
      active: true,
      percent: 3,
      statusText: `بدء نقل ورفع ملف الصورة (${fileSizeStr})...`,
      fileName: file.name,
      fileSizeFormatted: fileSizeStr,
      isError: false,
    });

    try {
      const uploadResp = await uploadLogoFileDirectly(
        selectedEventId,
        file,
        append,
        (percent, loaded, total) => {
          let statusText = `جاري رفع الصورة إلى السيرفر ... ${percent}% (${formatBytes(loaded)} / ${formatBytes(total)})`;
          if (percent >= 94) {
            statusText = "اكتمل نقل الملف، جاري معالجة وتحسين أبعاد الصورة بدقة 4K على السيرفر...";
          }
          setUploadProgress(prev => ({
            ...prev,
            active: true,
            percent,
            statusText,
            fileName: file.name,
            fileSizeFormatted: fileSizeStr,
            isError: false,
          }));
        }
      );

      if (uploadResp?.event?.branding?.targetLogos) {
        brandingForm.setValue("targetLogos", uploadResp.event.branding.targetLogos);
      }

      setUploadProgress(prev => ({
        ...prev,
        active: true,
        percent: 100,
        statusText: "تم الرفع بنجاح! تم حفظ وتحديث الشعار بنجاح ✨",
        isError: false,
      }));

      await Promise.all([
        utils.mosaic.listEvents.invalidate(),
        utils.mosaic.dashboard.invalidate(),
      ]);

      setNotice("تم رفع وتحديث الشعار بنجاح.");

      setTimeout(() => {
        setUploadProgress(prev => ({ ...prev, active: false }));
      }, 2400);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : "تعذر رفع ملف الصورة";
      setUploadProgress(prev => ({
        ...prev,
        active: true,
        isError: true,
        statusText: errMsg,
      }));
      setNotice(errMsg);
    }
  };

  const removeTargetLogo = (indexToRemove: number) => {
    if (!selectedEventId || !event) return;
    const currentTargets = event.branding.targetLogos && event.branding.targetLogos.length > 0
      ? [...event.branding.targetLogos]
      : (event.logoUrl ? [event.logoUrl] : []);
    if (currentTargets.length <= 1) {
      setNotice("At least one target image is required.");
      return;
    }
    const newTargets = currentTargets.filter((_, idx) => idx !== indexToRemove);
    brandingForm.setValue("targetLogos", newTargets);
    updateEvent.mutate({
      eventId: selectedEventId,
      branding: {
        ...event.branding,
        targetLogos: newTargets,
      },
    });
  };

  const [isDownloadingScreenshot, setIsDownloadingScreenshot] = useState(false);

  const handleDownloadScreenshot = async () => {
    if (!event || !selectedEventId || isDownloadingScreenshot) return;
    setIsDownloadingScreenshot(true);
    setNotice("جاري تجميع وتجهيز لقطة الحائط...");

    try {
      const allPhotos = dashboardQuery.data?.photos ?? [];
      const maxPhotos = event.settings?.maxPhotos ?? 0;
      const isMask = event.branding.logoDisplayMode === "mask" || event.branding.logoDisplayMode === "inverted-mask";
      const boardCapacity = maxPhotos > 0 ? maxPhotos : (isMask ? 112 : 144);
      const activeTargetIndex = (dashboardQuery.data?.control.targetIndex ?? 0) % Math.max(1, targetLogos.length);
      const currentLogoUrl = targetLogos[activeTargetIndex] || event.logoUrl || "";

      let boardPhotos = (targetLogos.length > 1 && event.branding.logoDisplayMode !== "letters")
        ? allPhotos.slice(activeTargetIndex * boardCapacity, (activeTargetIndex + 1) * boardCapacity)
        : allPhotos;

      if (boardPhotos.length === 0) {
        boardPhotos = allPhotos.slice(-boardCapacity);
      }

      const effectivePhotos = boardPhotos.length > 0
        ? boardPhotos
        : (dashboardQuery.data?.control.autoFill ? allPhotos : boardPhotos);

      const currentWidth = typeof window !== "undefined" ? window.innerWidth : 1920;
      const currentHeight = typeof window !== "undefined" ? window.innerHeight : 1080;

      await downloadMosaicScreenshot({
        eventName: event.name,
        photos: effectivePhotos,
        branding: event.branding,
        maxPhotos: event.settings?.maxPhotos ?? 0,
        logoUrl: currentLogoUrl,
        autoFill: dashboardQuery.data?.control.autoFill ?? false,
        stageIndex: activeTargetIndex,
        totalStages: targetLogos.length,
        width: currentWidth,
        height: currentHeight,
        onProgress: msg => setNotice(msg),
      });

      setNotice("تم تنزيل لقطة الحائط بنجاح! 📸");
    } catch (err: unknown) {
      setNotice(err instanceof Error ? err.message : "تعذر تنزيل لقطة الشاشة");
    } finally {
      setIsDownloadingScreenshot(false);
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
            {dashboardQuery.data.control.screensaver && (
              <div style={{ color: '#2563eb', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="status-dot" style={{ background: '#2563eb' }} />
                <span>WALL FROZEN (SCREENSAVER)</span>
              </div>
            )}
            {dashboardQuery.data.control.autoFill && (
              <div style={{ color: 'var(--copper-deep)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="status-dot" style={{ background: 'var(--copper)' }} />
                <span>AUTO-FILL ON</span>
              </div>
            )}
            {targetLogos.length > 1 && (
              <div style={{ color: 'var(--copper-deep)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="status-dot" style={{ background: 'var(--copper)' }} />
                <span>TARGET {currentControlTargetIndex + 1} OF {targetLogos.length}</span>
              </div>
            )}
            <Link href={eventLinks.mosaic} target="_blank" rel="noreferrer" className="button button--quiet">OPEN MOSAIC ↗</Link>
          </section>

          <section className="admin-columns">
            <div className="admin-panel admin-panel--branding">
              <div className="admin-section-heading">
                <div><p className="eyebrow">02 / IDENTITY</p><h2>Set the scene.</h2></div>
              </div>

              <div className="target-logos-manager">
                <div className="target-logos-manager__header">
                  <span className="target-logos-manager__title">TARGET MOSAIC IMAGES / صور أهداف الموزاييك ({targetLogos.length})</span>
                  <span className="subtle-count">STAGE PROGRESSION</span>
                </div>

                <div className="target-logos-grid">
                  {targetLogos.map((url, idx) => {
                    const isActive = idx === currentControlTargetIndex;
                    return (
                      <div className={`target-logo-card ${isActive ? "target-logo-card--active" : ""}`} key={`${url}-${idx}`}>
                        <div className="target-logo-card__preview">
                          <img src={url} alt={`Target logo ${idx + 1}`} />
                          <span className="target-logo-card__badge">TARGET {idx + 1}</span>
                          {isActive && <span className="target-logo-card__active-pill">● ACTIVE ON WALL</span>}
                        </div>
                        <div className="target-logo-card__actions">
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => controlEvent.mutate({ eventId: selectedEventId, action: "set-target", targetIndex: idx })}
                            disabled={isActive || controlEvent.isPending}
                          >
                            {isActive ? "VIEWING" : "SWITCH TO"}
                          </button>
                          {targetLogos.length > 1 && (
                            <button
                              type="button"
                              className="text-button text-button--danger"
                              onClick={() => removeTargetLogo(idx)}
                              disabled={updateEvent.isPending}
                            >
                              DELETE
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {uploadProgress.active && (
                  <div className="logo-upload-progress" role="status" aria-live="polite">
                    <div className="logo-upload-progress__header">
                      <div className="logo-upload-progress__file-info">
                        <span className="logo-upload-progress__icon" aria-hidden="true">🎨</span>
                        <strong className="logo-upload-progress__filename">{uploadProgress.fileName || "ملف الشعار"}</strong>
                        {uploadProgress.fileSizeFormatted && (
                          <span className="logo-upload-progress__size">({uploadProgress.fileSizeFormatted})</span>
                        )}
                      </div>
                      <span className={`logo-upload-progress__badge ${uploadProgress.isError ? "logo-upload-progress__badge--error" : uploadProgress.percent === 100 ? "logo-upload-progress__badge--done" : ""}`}>
                        {uploadProgress.isError ? "فشل" : `${uploadProgress.percent}%`}
                      </span>
                    </div>

                    <div className="logo-upload-progress__track">
                      <div
                        className={`logo-upload-progress__fill ${uploadProgress.isError ? "logo-upload-progress__fill--error" : ""} ${uploadProgress.percent === 100 ? "logo-upload-progress__fill--done" : ""}`}
                        style={{ width: `${Math.min(100, Math.max(3, uploadProgress.percent))}%` }}
                      />
                    </div>

                    <div className="logo-upload-progress__footer">
                      <span className={`logo-upload-progress__status ${uploadProgress.isError ? "logo-upload-progress__status--error" : ""}`}>
                        {uploadProgress.percent < 100 && !uploadProgress.isError && <span className="logo-upload-progress__spinner" aria-hidden="true" />}
                        {uploadProgress.statusText}
                      </span>
                    </div>
                  </div>
                )}

                <div className="target-logos-upload-bar">
                  <label
                    className={`button button--quiet ${uploadProgress.active ? "button--disabled" : ""}`}
                    htmlFor={uploadProgress.active ? undefined : "event-logo-input"}
                    style={{ pointerEvents: uploadProgress.active ? "none" : "auto", opacity: uploadProgress.active ? 0.6 : 1 }}
                  >
                    {uploadProgress.active ? `UPLOADING… (${uploadProgress.percent}%)` : targetLogos.length === 0 ? "UPLOAD TARGET LOGO" : "REPLACE FIRST LOGO"}
                  </label>
                  <input
                    id="event-logo-input"
                    className="visually-hidden"
                    type="file"
                    disabled={uploadProgress.active}
                    accept="image/png,image/svg+xml,image/jpeg,image/webp"
                    onChange={eventLogoChange => void uploadEventLogo(eventLogoChange, false)}
                  />

                  <label
                    className={`button button--accent ${uploadProgress.active ? "button--disabled" : ""}`}
                    htmlFor={uploadProgress.active ? undefined : "event-logo-append-input"}
                    style={{ pointerEvents: uploadProgress.active ? "none" : "auto", opacity: uploadProgress.active ? 0.6 : 1 }}
                  >
                    {uploadProgress.active ? `UPLOADING… (${uploadProgress.percent}%)` : "+ ADD NEXT TARGET IMAGE (إضافة صورة لوجو تالية)"}
                  </label>
                  <input
                    id="event-logo-append-input"
                    className="visually-hidden"
                    type="file"
                    disabled={uploadProgress.active}
                    accept="image/png,image/svg+xml,image/jpeg,image/webp"
                    onChange={eventLogoChange => void uploadEventLogo(eventLogoChange, true)}
                  />
                  <p style={{ margin: '4px 0 0', color: '#827b70', fontSize: '10px', width: '100%' }}>
                    PNG, SVG, JPG, WebP · يدعم رفع الصور الكبيرة والتصميمات فائقة الدقة (حتى 100+ MB) مع شريط تقدم مباشر لحظة بلحظة.
                  </p>
                </div>
              </div>

              <form className="branding-form" onSubmit={brandingForm.handleSubmit(branding => {
                const autoAdvance = typeof branding.autoAdvance === "string" ? branding.autoAdvance === "true" : Boolean(branding.autoAdvance ?? true);
                const currentTargets = targetLogos.length > 0
                  ? targetLogos
                  : (event.branding?.targetLogos?.length ? event.branding.targetLogos : (event.logoUrl ? [event.logoUrl] : []));
                updateEvent.mutate({
                  eventId: selectedEventId,
                  branding: {
                    ...branding,
                    targetLogos: currentTargets,
                    maskCorners: event.branding?.maskCorners,
                    autoAdvance,
                  },
                });
              })}>
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
                  <label className="field-label">LOGO SCALE (%)<input className="field-input" type="number" min={10} max={100} {...brandingForm.register("logoScale", { valueAsNumber: true })} /></label>
                </div>
                <div className="branding-form__row">
                  <label className="field-label">MOTION SPEED (سرعة الحركة)
                    <select className="field-select" {...brandingForm.register("animationSpeed")}><option value="calm">Calm (هادئ)</option><option value="cinematic">Cinematic (سينمائي)</option><option value="energetic">Energetic (سريع)</option></select>
                  </label>
                  <label className="field-label" style={{ color: 'var(--copper, #e49a62)' }}>
                    SPOTLIGHT TIME / وقت بقاء الصورة كبيرة (بالثواني)
                    <input
                      className="field-input"
                      type="number"
                      step="0.5"
                      min={0.5}
                      max={15}
                      placeholder="3"
                      style={{ borderColor: 'var(--copper, #e49a62)', fontWeight: 700 }}
                      {...brandingForm.register("arrivalHoldDuration", { valueAsNumber: true })}
                    />
                  </label>
                </div>
                <div className="branding-form__row">
                  <label className="field-label">WALL THEME
                    <select className="field-select" {...brandingForm.register("theme")}><option value="dark">Ink dark</option><option value="light">Warm light</option></select>
                  </label>
                  <label className="field-label">INTRO LOGO POSITION
                    <select className="field-select" {...brandingForm.register("logoPosition")}><option value="center">Center</option><option value="top-left">Top left</option><option value="top-right">Top right</option></select>
                  </label>
                </div>
                <div className="branding-form__row">
                  <label className="field-label" style={{ gridColumn: 'span 2', width: '100%' }}>
                    INTRO LOGO MOMENT
                    <select className="field-select" {...brandingForm.register("logoAnimation")}><option value="reveal">Cinematic reveal</option><option value="none">No logo animation</option></select>
                  </label>
                </div>

                <div className="branding-form__row">
                  <label className="field-label" style={{ gridColumn: 'span 2', width: '100%' }}>
                    LOGO DISPLAY MODE / طريقة ظهور اللوجو على الشاشة
                    <select
                      className="field-select"
                      style={{
                        borderColor: 'var(--accent, #E49A62)',
                        fontWeight: 700,
                        backgroundColor: 'rgba(228, 154, 98, 0.08)',
                      }}
                      {...brandingForm.register("logoDisplayMode")}
                    >
                      <option value="watermark">1. Central Watermark Overlay (علامة مائية موحدة في المنتصف فوق الصور)</option>
                      <option value="mask">2. Logo Shape Cutout (تفريغ شكل اللوجو - الصور داخل اللوجو فقط)</option>
                      <option value="inverted-mask">3. Around Logo / Inverse (الصور في الفراغات المحيطة باللوجو وترك اللوجو بارزاً في المنتصف)</option>
                      <option value="letters">4. Letters Fill / تفريغ داخل الحروف (HAYAH SHARKS)</option>
                    </select>
                  </label>
                </div>

                <div style={{ display: selectedLogoDisplayMode === 'watermark' ? 'contents' : 'none' }}>
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
                </div>

                {selectedLogoDisplayMode === 'mask' && (
                  <div style={{ padding: '12px 14px', borderRadius: '6px', background: 'rgba(228, 154, 98, 0.1)', border: '1px solid rgba(228, 154, 98, 0.25)', fontSize: '0.85rem', lineHeight: '1.5' }}>
                    <strong style={{ color: 'var(--accent, #E49A62)' }}>✓ تم تفعيل نظام تفريغ اللوجو (Logo Shape Cutout):</strong>
                    <p style={{ margin: '6px 0 0', opacity: 0.85 }}>
                      الصور ستملأ فقط المربعات التي تشكّل اللوجو الشفاف وتتجمع تدريجياً. يُفضل اختيار Grid Size محدد (مثل 112 أو 144 صورة) من لوحة Live Wall لضبط عدد المربعات ودقة التفاصيل.
                    </p>
                  </div>
                )}

                {selectedLogoDisplayMode === 'inverted-mask' && (
                  <div style={{ display: 'grid', gap: '12px' }}>
                    <div style={{ padding: '12px 14px', borderRadius: '6px', background: 'rgba(228, 154, 98, 0.1)', border: '1px solid rgba(228, 154, 98, 0.25)', fontSize: '0.85rem', lineHeight: '1.5' }}>
                      <strong style={{ color: 'var(--accent, #E49A62)' }}>✓ وضع ملء الفراغات حول اللوجو (Around Logo / Inverse):</strong>
                      <p style={{ margin: '6px 0 0', opacity: 0.85 }}>
                        الصور ستملأ كافة المربعات المحيطة باللوجو كخلفية موزاييك، بينما يظل شكل اللوجو بارزاً وأنيقاً في المنتصف محاطاً بذكريات الحاضرين.
                      </p>
                    </div>

                    <div className="branding-form__row" style={{ background: 'rgba(228, 154, 98, 0.06)', padding: '12px 14px', borderRadius: '4px', border: '1px solid rgba(228, 154, 98, 0.35)', alignItems: 'center' }}>
                      <label className="field-label">
                        CENTER LOGO SIZE (%) / حجم اللوجو في المنتصف
                        <input
                          className="field-input"
                          type="number"
                          min={15}
                          max={90}
                          style={{ fontWeight: 750, borderColor: 'var(--accent, #E49A62)', fontSize: '15px' }}
                          placeholder="مثلاً: 45%"
                          {...brandingForm.register("logoScale", { valueAsNumber: true })}
                        />
                      </label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: '#827b70', lineHeight: '1.4' }}>
                        <span>• القيمة المقترحة: <strong>35% - 55%</strong></span>
                        <span>• كلما صغّرت الحجم زادت مساحة شبكة الصور حول اللوجو، وكلما كبّرته برز اللوجو أكثر في المنتصف.</span>
                      </div>
                    </div>
                  </div>
                )}

                {selectedLogoDisplayMode === 'letters' && (
                  <div style={{ display: 'grid', gap: '12px' }}>
                    <div style={{ padding: '12px 14px', borderRadius: '6px', background: 'rgba(228, 154, 98, 0.1)', border: '1px solid rgba(228, 154, 98, 0.25)', fontSize: '0.85rem', lineHeight: '1.5' }}>
                      <strong style={{ color: 'var(--accent, #E49A62)' }}>✓ وضع تفريغ الحروف المخصص (HAYAH SHARKS Letters Grid):</strong>
                      <p style={{ margin: '6px 0 0', opacity: 0.85 }}>
                        يظهر لوجو HAYAH SHARKS في منتصف الشاشة الرئيسية، وتُعرض صور الحاضرين كشبكة موزاييك متقنة (Grid) داخل حروف الكلمة تتسع لعشرات ومئات الصور الموزعة عشوائياً بدقة.
                      </p>
                    </div>

                    <div className="branding-form__row" style={{ background: 'rgba(228, 154, 98, 0.06)', padding: '12px 14px', borderRadius: '4px', border: '1px solid rgba(228, 154, 98, 0.35)', alignItems: 'center' }}>
                      <label className="field-label" style={{ gridColumn: 'span 2', width: '100%' }}>
                        LETTERS DISTRIBUTION / طريقة توزيع الصور داخل الحروف
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginTop: '6px' }}>
                          <button
                            type="button"
                            className={`button ${currentLettersMode === 'grid' ? 'button--accent' : 'button--quiet'}`}
                            onClick={() => handleSetLettersMode('grid')}
                            style={{ padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: '3px', textAlign: 'center', height: 'auto', alignItems: 'center' }}
                          >
                            <strong style={{ fontSize: '12px' }}>Grid (3×3)</strong>
                            <span style={{ fontSize: '10px', opacity: 0.9 }}>شبكة موزاييك (3 صفوف)</span>
                            <span style={{ fontSize: '9px', opacity: 0.7 }}>99 خانة متوازنة</span>
                          </button>
                          <button
                            type="button"
                            className={`button ${currentLettersMode === 'dense' ? 'button--accent' : 'button--quiet'}`}
                            onClick={() => handleSetLettersMode('dense')}
                            style={{ padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: '3px', textAlign: 'center', height: 'auto', alignItems: 'center' }}
                          >
                            <strong style={{ fontSize: '12px' }}>Dense (4×4)</strong>
                            <span style={{ fontSize: '10px', opacity: 0.9 }}>شبكة مكثفة (4 صفوف)</span>
                            <span style={{ fontSize: '9px', opacity: 0.7 }}>176 خانة للزحام</span>
                          </button>
                          <button
                            type="button"
                            className={`button ${currentLettersMode === 'strip' ? 'button--accent' : 'button--quiet'}`}
                            onClick={() => handleSetLettersMode('strip')}
                            style={{ padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: '3px', textAlign: 'center', height: 'auto', alignItems: 'center' }}
                          >
                            <strong style={{ fontSize: '12px' }}>Strip</strong>
                            <span style={{ fontSize: '10px', opacity: 0.9 }}>شريط الكلمة (3 صفوف)</span>
                            <span style={{ fontSize: '9px', opacity: 0.7 }}>3 صفوف ممتدة</span>
                          </button>
                        </div>
                        <input type="hidden" {...brandingForm.register("lettersMode")} />
                      </label>
                    </div>

                    <div className="branding-form__row" style={{ background: 'rgba(228, 154, 98, 0.06)', padding: '12px 14px', borderRadius: '4px', border: '1px solid rgba(228, 154, 98, 0.35)', alignItems: 'center' }}>
                      <label className="field-label">
                        CENTER LOGO SIZE (%) / حجم اللوجو على الشاشة
                        <input
                          className="field-input"
                          type="number"
                          min={20}
                          max={100}
                          style={{ fontWeight: 750, borderColor: 'var(--accent, #E49A62)', fontSize: '15px' }}
                          placeholder="مثلاً: 85%"
                          {...brandingForm.register("logoScale", { valueAsNumber: true })}
                        />
                      </label>
                      <label className="field-label">
                        LOGO OPACITY (%) / وضوح اللوجو
                        <input
                          className="field-input"
                          type="number"
                          min={0}
                          max={100}
                          style={{ fontWeight: 750, borderColor: 'var(--accent, #E49A62)', fontSize: '15px' }}
                          placeholder="100%"
                          {...brandingForm.register("watermarkOpacity", { valueAsNumber: true })}
                        />
                      </label>
                    </div>

                    <div className="branding-form__row" style={{ background: 'rgba(228, 154, 98, 0.06)', padding: '12px 14px', borderRadius: '4px', border: '1px solid rgba(228, 154, 98, 0.35)', alignItems: 'center' }}>
                      <label className="field-label" style={{ gridColumn: 'span 2', width: '100%' }}>
                        LOGO BLEND MODE / نمط دمج اللوجو
                        <select className="field-select" {...brandingForm.register("watermarkBlendMode")}>
                          <option value="normal">Normal (الأوضح للحفاظ على ألوان اللوجو ورسمة القرش كاملة)</option>
                          <option value="hard-light">Hard light</option>
                          <option value="overlay">Overlay</option>
                          <option value="screen">Screen</option>
                          <option value="multiply">Multiply</option>
                          <option value="soft-light">Soft light</option>
                        </select>
                      </label>
                    </div>
                  </div>
                )}

                <div className="branding-form__row">
                  <label className="field-label">
                    AUTO-ADVANCE WHEN FILLED / الانتقال التلقائي للصورة التالية
                    <select
                      className="field-select"
                      style={{
                        borderColor: 'var(--copper)',
                        fontWeight: 650,
                      }}
                      {...brandingForm.register("autoAdvance")}
                    >
                      <option value="true">Yes (تلقائي عند اكتمال صور الحائط)</option>
                      <option value="false">No (Manual only / يدوي فقط)</option>
                    </select>
                  </label>
                  <label className="field-label">
                    ADVANCE DELAY (SECONDS) / مدة العرض قبل الانتقال
                    <input
                      className="field-input"
                      type="number"
                      min={1}
                      max={60}
                      {...brandingForm.register("autoAdvanceDelay", { valueAsNumber: true })}
                    />
                  </label>
                </div>

                <div className="branding-form__row">
                  <label className="field-label" style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                    PERSPECTIVE MASK / ضبط أركان الشاشة
                    <button type="button" className="button button--quiet" onClick={() => setIsMaskEditorOpen(true)}>EDIT CORNERS (تعديل أركان المنظور)</button>
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
                <div className="control-console__buttons">
                  <button className="control-button" type="button" onClick={() => controlEvent.mutate({ eventId: selectedEventId, action: dashboardQuery.data.control.playing ? "pause" : "play" })} disabled={controlEvent.isPending}>
                    <span>{dashboardQuery.data.control.playing ? "Ⅱ" : "▶"}</span>{dashboardQuery.data.control.playing ? "PAUSE" : "PLAY"}
                  </button>
                  <button className="control-button" type="button" onClick={() => controlEvent.mutate({ eventId: selectedEventId, action: "restart" })} disabled={controlEvent.isPending}>
                    <span>↺</span>RESTART
                  </button>
                  <button
                    className={`control-button control-button--screenshot ${isDownloadingScreenshot ? "control-button--active" : ""}`}
                    type="button"
                    onClick={() => void handleDownloadScreenshot()}
                    disabled={isDownloadingScreenshot}
                    title="تنزيل لقطة شاشة للحائط بأبعاد الشاشة الحالية"
                  >
                    <span>📸</span>
                    {isDownloadingScreenshot ? "SAVING…" : "SCREENSHOT"}
                  </button>
                  <button
                    className={`control-button ${dashboardQuery.data.control.autoFill ? "control-button--active" : ""}`}
                    type="button"
                    onClick={() => controlEvent.mutate({ eventId: selectedEventId, action: "toggle-fill" })}
                    disabled={controlEvent.isPending}
                    title="تكرار الصور الحالية لملء كافة الفراغات والمربعات الفارغة المتبقية على الشاشة"
                  >
                    <span>{dashboardQuery.data.control.autoFill ? "★" : "☆"}</span>
                    {dashboardQuery.data.control.autoFill ? "AUTO-FILL: ON" : "FILL WALL"}
                  </button>
                  <button
                    className={`control-button ${dashboardQuery.data.control.screensaver ? "control-button--frozen" : ""}`}
                    type="button"
                    onClick={() => controlEvent.mutate({ eventId: selectedEventId, action: "toggle-screensaver" })}
                    disabled={controlEvent.isPending}
                    title="تثبيت الشاشة كسكرين سيفر - يحفظ الصور الجديدة دون عرضها على الشاشة حتى إلغاء التثبيت"
                  >
                    <span>❄</span>
                    {dashboardQuery.data.control.screensaver ? "FROZEN (ON)" : "SCREENSAVER"}
                  </button>
                  <button className="control-button control-button--clear" type="button" onClick={() => controlEvent.mutate({ eventId: selectedEventId, action: "clear" })} disabled={controlEvent.isPending}>
                    <span>⌫</span>CLEAR WALL
                  </button>
                </div>

                <div className="control-console__target-row">
                  <div className="target-control-bar">
                    <button
                      className="control-button"
                      type="button"
                      onClick={() => controlEvent.mutate({ eventId: selectedEventId, action: "prev-target" })}
                      disabled={controlEvent.isPending}
                      title="الانتقال إلى صورة الهدف السابقة"
                    >
                      <span>⏮</span> PREV TARGET
                    </button>
                    <div className="target-control-indicator">
                      <span className="target-indicator-tag">ACTIVE BOARD TARGET</span>
                      <strong>
                        Target {currentControlTargetIndex + 1} of {Math.max(1, targetLogos.length)}
                      </strong>
                    </div>
                    <button
                      className="control-button"
                      type="button"
                      onClick={() => controlEvent.mutate({ eventId: selectedEventId, action: "next-target" })}
                      disabled={controlEvent.isPending}
                      title="الانتقال إلى صورة الهدف التالية"
                    >
                      <span>⏭</span> NEXT TARGET
                    </button>
                  </div>
                </div>

                {(event?.branding?.logoDisplayMode === 'letters' || selectedLogoDisplayMode === 'letters') && (
                  <div
                    className="letters-mode-control-bar"
                    style={{
                      marginTop: '10px',
                      padding: '12px 14px',
                      borderRadius: '8px',
                      background: 'rgba(228, 154, 98, 0.08)',
                      border: '1px solid rgba(228, 154, 98, 0.35)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <strong style={{ color: 'var(--copper-deep, #e49a62)', fontSize: '11px', letterSpacing: '0.08em' }}>
                        LETTERS DISTRIBUTION / نمط توزيع الحروف على الشاشة الحية
                      </strong>
                      <span style={{ fontSize: '10px', color: '#827b70' }}>LIVE SWITCHER</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                      <button
                        type="button"
                        className={`control-button ${currentLettersMode === 'grid' ? 'control-button--active' : ''}`}
                        onClick={() => handleSetLettersMode('grid')}
                        disabled={updateEvent.isPending}
                        title="شبكة موزاييك متوازنة (3 صفوف لكل حرف - 99 خانة)"
                        style={{ height: 'auto', padding: '9px 8px', display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'center', textAlign: 'center' }}
                      >
                        <span style={{ fontWeight: 800, fontSize: '12px' }}>Grid (3×3)</span>
                        <span style={{ fontSize: '10px', opacity: 0.9 }}>شبكة موزاييك (3 صفوف)</span>
                      </button>
                      <button
                        type="button"
                        className={`control-button ${currentLettersMode === 'dense' ? 'control-button--active' : ''}`}
                        onClick={() => handleSetLettersMode('dense')}
                        disabled={updateEvent.isPending}
                        title="شبكة مكثفة (4 صفوف لكل حرف - 176 خانة)"
                        style={{ height: 'auto', padding: '9px 8px', display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'center', textAlign: 'center' }}
                      >
                        <span style={{ fontWeight: 800, fontSize: '12px' }}>Dense (4×4)</span>
                        <span style={{ fontSize: '10px', opacity: 0.9 }}>شبكة مكثفة (4 صفوف)</span>
                      </button>
                      <button
                        type="button"
                        className={`control-button ${currentLettersMode === 'strip' ? 'control-button--active' : ''}`}
                        onClick={() => handleSetLettersMode('strip')}
                        disabled={updateEvent.isPending}
                        title="شريط الكلمة (3 صفوف عبر الكلمة)"
                        style={{ height: 'auto', padding: '9px 8px', display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'center', textAlign: 'center' }}
                      >
                        <span style={{ fontWeight: 800, fontSize: '12px' }}>Strip</span>
                        <span style={{ fontSize: '10px', opacity: 0.9 }}>شريط الكلمة (3 صفوف)</span>
                      </button>
                    </div>
                  </div>
                )}

                {dashboardQuery.data.control.screensaver && (
                  <div style={{ marginTop: '12px', padding: '10px 14px', borderRadius: '4px', background: 'rgba(59, 130, 246, 0.12)', border: '1px solid rgba(59, 130, 246, 0.4)', color: '#1d4ed8', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1.2rem' }}>❄</span>
                    <div>
                      <strong>وضع السكرين سيفر مفعّل (الشاشة مثبتة):</strong>
                      <div style={{ marginTop: '2px', opacity: 0.9 }}>يتم حفظ وتخزين جميع الصور الجديدة القادمة من البوث في المعرض تلقائياً دون عرضها على شاشة الموزاييك الحية، حتى يتم إلغاء التثبيت.</div>
                    </div>
                  </div>
                )}

                {dashboardQuery.data.control.autoFill && (
                  <div style={{ marginTop: '10px', padding: '9px 12px', borderRadius: '4px', background: 'rgba(228, 154, 98, 0.12)', border: '1px solid rgba(228, 154, 98, 0.35)', color: 'var(--copper-deep)', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1.2rem' }}>★</span>
                    <div>
                      <strong>ملء الفراغات مفعّل:</strong>
                      <div style={{ marginTop: '2px', opacity: 0.9 }}>يتم تكرار الصور الحالية تلقائياً لتغطية كامل المربعات والمساحات المتبقية في الحائط.</div>
                    </div>
                  </div>
                )}

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
                      <button type="button" style={{color: 'var(--mosaic-accent)', opacity: 0.8, marginLeft: 'auto', justifySelf: 'flex-end'}} onClick={() => { if(confirm("Permanently delete this photo?")) deletePhoto.mutate({ eventId: selectedEventId, photoId: photo.id }) }} disabled={deletePhoto.isPending}>DELETE</button>
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

          <section className="admin-reset-row" style={{ marginTop: '2rem' }}>
            <div><p className="eyebrow" style={{ color: 'var(--mosaic-accent)' }}>DANGER ZONE</p><p>Permanently delete this event and all associated photos from the disk and database. This cannot be undone.</p></div>
            <button className="button button--accent" type="button" onClick={() => { if(confirm("Are you sure you want to permanently delete this event and all its photos?")) deleteEvent.mutate(selectedEventId) }} disabled={deleteEvent.isPending}>DELETE EVENT FOREVER</button>
          </section>

          {isMaskEditorOpen && event && (
            <Suspense fallback={null}>
              <MosaicMaskEditor
                branding={event.branding}
                logoUrl={event.logoUrl}
                onCancel={() => setIsMaskEditorOpen(false)}
                onSave={(corners) => {
                  updateEvent.mutate({ eventId: selectedEventId, branding: { ...event.branding, maskCorners: corners } });
                  setIsMaskEditorOpen(false);
                }}
              />
            </Suspense>
          )}
        </>
      )}

      {selectedEventId && dashboardQuery.isLoading && <div className="admin-loading">LOADING EVENT CONTROL…</div>}
      {eventsQuery.isError && <p className="field-error" role="alert">Events could not be loaded. Refresh the page to retry.</p>}
    </main>
  );
}
