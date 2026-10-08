import { useEffect, useRef, useState } from "react";
import { useRoute } from "wouter";
import { ApertureMark, MosaicWordmark } from "../../components/MosaicBrand";
import { trpc } from "../../lib/trpc";
import { eventIdSchema, uuidSchema, type PhotoPayload } from "../../../../shared/mosaic";

export default function GalleryPage() {
  const [, params] = useRoute("/gallery/:eventId");
  const parsedEventId = eventIdSchema.safeParse(params?.eventId);
  const eventId = parsedEventId.success ? parsedEventId.data : null;
  const initialCursor = new URLSearchParams(window.location.search).get("cursor") ?? undefined;
  const highlightId = new URLSearchParams(window.location.search).get("photo");
  const parsedPhotoId = uuidSchema.safeParse(highlightId);
  const [cursor, setCursor] = useState<string | undefined>(initialCursor);
  const [pages, setPages] = useState<PhotoPayload[][]>([]);
  const loadedCursors = useRef(new Set<string>());
  const [selected, setSelected] = useState<PhotoPayload | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const eventQuery = trpc.mosaic.publicEvent.useQuery(eventId ?? "invalid", {
    enabled: Boolean(eventId), retry: 1, refetchOnWindowFocus: false,
  });
  const pageQuery = trpc.mosaic.gallery.useQuery({ eventId: eventId ?? "invalid", cursor }, {
    enabled: Boolean(eventId), retry: 1, refetchOnWindowFocus: false,
  });
  const deepLinkedPhotoQuery = trpc.mosaic.publicPhoto.useQuery({
    eventId: eventId ?? "invalid",
    photoId: parsedPhotoId.success ? parsedPhotoId.data : "00000000-0000-0000-0000-000000000000",
  }, {
    enabled: Boolean(eventId && parsedPhotoId.success), retry: 1, refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!pageQuery.data) return;
    const key = cursor ?? "first";
    if (loadedCursors.current.has(key)) return;
    loadedCursors.current.add(key);
    setPages(current => [...current, pageQuery.data.photos]);
  }, [pageQuery.data, cursor]);

  useEffect(() => {
    if (!highlightId || !deepLinkedPhotoQuery.isSuccess) return;
    if (deepLinkedPhotoQuery.data) setSelected(deepLinkedPhotoQuery.data);
    else setShareMessage("That photo is no longer available in this event gallery.");
  }, [deepLinkedPhotoQuery.data, deepLinkedPhotoQuery.isSuccess, highlightId]);

  useEffect(() => {
    if (!selected) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selected]);

  const photos = pages.flat();
  const sharePhoto = async (photo: PhotoPayload) => {
    const url = new URL(`/gallery/${encodeURIComponent(photo.eventId)}?photo=${encodeURIComponent(photo.id)}`, window.location.origin).toString();
    try {
      if (navigator.share) await navigator.share({ title: eventQuery.data?.name ?? "Event photo", url });
      else {
        await navigator.clipboard.writeText(url);
        setShareMessage("Photo link copied.");
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") return;
      setShareMessage("Sharing is not available on this device.");
    }
  };

  if (!eventId) {
    return <main className="screen-message"><ApertureMark className="screen-message__mark" /><p className="eyebrow">EVENT GALLERY</p><h1>This gallery link is incomplete.</h1><p>Ask the event team for the guest gallery link.</p></main>;
  }
  if (eventQuery.isLoading) return <main className="screen-message"><MosaicWordmark /><p>FINDING YOUR EVENT PHOTOS</p></main>;
  if (!eventQuery.data) return <main className="screen-message"><h1>Gallery unavailable.</h1><p>This event link may have expired or changed.</p></main>;

  const event = eventQuery.data;
  return (
    <main className="gallery-shell">
      <header className="gallery-topbar"><a href="/" aria-label="Mosaic home"><MosaicWordmark compact /></a><span className="gallery-topbar__label">GUEST PHOTO GALLERY</span></header>
      <section className="gallery-heading">
        <p className="eyebrow">A ROOM FULL OF MOMENTS</p>
        <h1>{event.name}</h1>
        <p>Find your moment. Keep it close. Share the feeling.</p>
      </section>

      {shareMessage && <div className="gallery-notice" role="status">{shareMessage}<button type="button" aria-label="Dismiss" onClick={() => setShareMessage(null)}>×</button></div>}
      {pageQuery.isError && <div className="gallery-error" role="alert">Photos could not be loaded. <button className="text-button" type="button" onClick={() => void pageQuery.refetch()}>TRY AGAIN</button></div>}
      {photos.length === 0 && !pageQuery.isLoading ? (
        <div className="gallery-empty"><ApertureMark /><h2>The wall is waiting.</h2><p>Photos from this event will appear here.</p></div>
      ) : (
        <div className="gallery-grid">
          {photos.map(photo => (
            <button
              type="button"
              key={photo.id}
              className={`gallery-tile${highlightId === photo.id ? " gallery-tile--highlight" : ""}`}
              onClick={() => setSelected(photo)}
              aria-label={`Open event photo from ${new Date(photo.createdAt).toLocaleTimeString()}`}
            >
              <img src={photo.thumbnailUrl} alt="" loading="lazy" decoding="async" />
              <span className="gallery-tile__open" aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
      )}

      {pageQuery.data?.nextCursor && (
        <div className="gallery-more"><button className="button button--quiet" type="button" disabled={pageQuery.isFetching} onClick={() => setCursor(pageQuery.data?.nextCursor ?? undefined)}>
          {pageQuery.isFetching ? "LOADING…" : "LOAD MORE PHOTOS"}
        </button></div>
      )}
      <footer className="gallery-footer"><span>EVERY MOMENT, PART OF THE ROOM</span><span>{event.name}</span></footer>

      {selected && (
        <div className="photo-lightbox" role="dialog" aria-modal="true" aria-labelledby="lightbox-title" onMouseDown={eventMouse => {
          if (eventMouse.target === eventMouse.currentTarget) setSelected(null);
        }}>
          <div className="photo-lightbox__panel">
            <button className="photo-lightbox__close" type="button" aria-label="Close photo" onClick={() => setSelected(null)}>×</button>
            <img className="photo-lightbox__image" src={selected.imageUrl} alt={`Photo from ${event.name}`} />
            <div className="photo-lightbox__details"><div><p className="eyebrow">A MOMENT FROM</p><h2 id="lightbox-title">{event.name}</h2></div><time>{new Date(selected.createdAt).toLocaleString()}</time></div>
            <div className="photo-lightbox__actions">
              <a className="button button--accent" href={`/api/events/${encodeURIComponent(event.id)}/photos/${encodeURIComponent(selected.id)}/download`}>DOWNLOAD PHOTO</a>
              <button className="button button--quiet" type="button" onClick={() => void sharePhoto(selected)}>SHARE PHOTO</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
