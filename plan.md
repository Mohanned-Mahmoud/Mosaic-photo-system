# Mosaic Live Event Photo Experience — Implementation Plan

## Product scope

Build the four requested experiences on the initialized Mosaic project: `/booth`, `/mosaic`, `/admin`, and `/gallery/:eventId` (the client-side equivalent of `/gallery/[eventId]`). The core path is a guest capture → preview → retake or confirm → compressed upload → durable photo record → event-scoped live update → animated arrival on a separate Mosaic display. No timer-generated updates or hardcoded/stock sample photos will be used. An event with no guest images will have a deliberate empty opening state rather than fake tiles.

The only supplied attachment is the written specification; no reference video was present in the workspace. The Mosaic motion will therefore follow the written direction: a new real photo enters from above, travels down to its destination, and settles into the wall.

## Implementation approach

Preserve the actual starter: React 19, TypeScript, Vite, Wouter, Tailwind 4, Express, tRPC, Drizzle/MySQL, React Query, Zod, and the existing managed storage helpers. Keep the platform OAuth infrastructure in the starter but do not use it to gate `/admin`; the user explicitly approved public event and photo controls, overriding the original admin-security requirement. Next.js is not appropriate for this initialized Vite application: its kiosk screens depend on browser camera APIs, and the existing server/client stack already handles the product routes and APIs. Use the installed libraries before considering additions; add only narrowly justified packages for safe upload decoding and transfer.

The managed MySQL database will own events, booths, photo metadata, and Mosaic state. The managed object store will own image bytes; the existing server-side `storagePut` helper returns stable `/manus-storage/...` addresses. Browser code will never receive storage credentials. A server endpoint will validate event/booth IDs, upload size, file signature, and allowed image type before accepting photo data and recording it. Image work will produce an optimized display image and smaller tile thumbnail, while the live channel sends only photo metadata and stable image references.

Use Express Server-Sent Events (SSE) for event-scoped, one-way Mosaic updates: the photo is committed first, then the server emits its ID and metadata to listeners for that event. SSE reconnects automatically. A bounded database snapshot is reconciled every 2.5 seconds to recover missed photos, controls, branding, and booth heartbeats even when an upload and display connect to different server processes; unchanged snapshots short-circuit state updates. The client deduplicates by photo ID. Existing photos remain visible while disconnected. Keep the current display DOM and retained images bounded by the number of screen tiles, not the total lifetime photo count.

Use tRPC for typed public event-list/create/update, photo-list, Mosaic-control, and booth-presence APIs. Keep the streaming endpoint, binary photo upload, and attachment download as ordinary Express routes. `/admin` and its complete API surface are intentionally public: any visitor can create or select events, edit branding, pause/restart/clear a wall, or hide photos. The operator page must visibly warn users that its controls are public. Booth, Mosaic, gallery, and all mutations remain scoped to a validated event ID; every photo is associated with an event and booth. Public event IDs are not access credentials. Booth presence is tracked separately from photo delivery so the operator can see recently connected booth devices.

The booth will be a small explicit state machine (ready, requesting camera, countdown, preview, uploading, confirmed, recoverable error). The live camera fills the screen; the countdown and confirmation use touch-sized controls. Capture will be resized/compressed before upload. A failed upload retains the guest's photo and offers retry; a small IndexedDB outbox with the same photo ID on retry is the proposed recovery path so retries remain idempotent and can resume after connectivity returns.

The Mosaic is a separate 16:9 full-screen composition, not a stretched booth page. Its opening logo reveal transitions into a tightly spaced square-photo wall. On each event, preload the new thumbnail and animate a temporary overlay from the top to the destination tile using transform and opacity, then commit the tile. Queue or bound rapid arrivals so concurrent captures do not create an unbounded set of animation layers. Pause, restart, and clear are persisted event controls so a refreshed/reconnected screen restores the operator's current intent. Clearing removes the wall presentation without deleting stored photo records.

The public gallery will be mobile-first and paginated, with preview, download, and share links. The optional QR on booth confirmation will point to the guest's photo within that event's gallery. The operator surface will support event creation/selection, logo and branding edits, counts and booth presence, photo moderation, gallery access, and Play/Pause/Restart/Clear/Reset controls.

## Data and privacy boundaries

- `events`: generated event ID, nullable legacy creator identity (not an authorization boundary), name, logo reference, centralized branding/settings, creation/update times, and active/session state.
- `booths`: booth ID, event ID, optional operator label, and last-seen time.
- `photos`: unique photo ID, event ID, booth ID, optimized image and thumbnail references, created time, and moderation/Mosaic visibility state.
- `mosaic state`: per-event pause state and revision/clear/restart markers, persisted so displays can synchronize after refresh.

Photo IDs are stable across retries. Database writes and queries always include the event ID. Public booth, gallery, display, and admin APIs are limited to the selected validated event ID; as explicitly approved, no event-owner check or sign-in protects public admin mutations. This exposes event creation, branding, wall controls, and soft-hide actions to any visitor. Photo bytes are not sent repeatedly over SSE.

**Storage constraint:** the managed runtime storage API supports uploads and reads but does not expose physical object deletion to the application. The implementation uses a soft delete: remove the photo from the Mosaic, gallery, and normal application queries while retaining the database audit record and underlying object bytes. The app must not imply that this erases the stored file. Permanent object deletion would require a separate storage purge capability, which is not available to the current application runtime.

## Project structure

```text
app.config.ts                  Quoted durable platform-logo URL
plan.md / TODO.md              Approved design decisions and complete open outcomes
client/
  index.html                   Site title, viewport, and favicon reference
  public/
    manus-routes.json          Exact public page route manifest
    mosaic-mark.svg            Site favicon
  src/
    App.tsx                    Lazy Wouter route composition and shared providers
    main.tsx                   Ordered public-config bootstrap, tRPC and React Query
    features/
      booth/                   Camera, countdown, capture, compression, retry outbox
      mosaic/                  Opening/logo reveal, bounded tile wall, SSE and state merge
      admin/                   Public operator controls, event branding and photo moderation
      gallery/                 Event-scoped, paginated preview/download/share surface
      app.css                  Shared tokens, responsive layouts, and GPU-friendly motion
    components/                Shared error boundary and original aperture wordmark
    pages/                     Editorial product landing page
    lib/                       Typed tRPC client
server/
  mosaic/                      Event repository, public tRPC APIs, upload/SSE,
                               image validation/processing and realtime fan-out
  _core/                       Existing OAuth, Express/Vite startup, health and platform config
  routers.ts / db.ts / storage.ts Shared router, MySQL and managed-object-store boundaries
shared/mosaic.ts               Shared Zod schemas and event/photo/control DTOs
drizzle/
  schema.ts                    Managed MySQL event, booth, photo and Mosaic-state tables
  0001_*.sql, 0002_*.sql + meta/ Additive migrations, journal and schema snapshots
```

## Design direction

- **Design movement:** cinematic editorial exhibition design, with analog-photography restraint rather than a generic SaaS dashboard.
- **Core principles:** (1) the guest's face/photo is the hero; (2) one obvious action at a time; (3) event branding is configurable rather than baked into components; (4) the display stays calm and legible at a distance.
- **Color philosophy:** use ink/charcoal and warm mineral neutrals to frame photography accurately; reserve a single warm copper/apricot accent for capture, live status, and focus. Event-specific colors flow through a small CSS-variable branding layer.
- **Layout paradigm:** the Booth is a single full-screen capture stage; the Mosaic is a full-bleed 16:9 image field; the Admin is a compact operator workbench with a clear current-event context; the Gallery is a mobile-first photo index. These are purpose-built surfaces, not one responsive dashboard template.
- **Signature elements:** an aperture made from six offset square frames; hairline tile seams that make the wall read as one installation; a restrained live-state marker that echoes a camera tally light.
- **Interaction philosophy:** controls are tactile and immediate. The booth should need no explanation; admin changes should show clear saved/error states; destructive presentation controls must distinguish clearing the wall from deleting a record.
- **Animation:** use opacity and transforms for countdown, logo reveal, and photo insertion; preload before motion; limit concurrent overlays; avoid animating grid dimensions or expensive layout properties; respect `prefers-reduced-motion`; keep ambient motion subtle and never reshuffle the full wall.
- **Typography system:** expressive system-serif display headlines (Georgia/Iowan-style fallbacks) paired with a neutral system sans for controls and data. Use short uppercase labels with deliberate tracking; avoid external font downloads so event devices remain reliable offline or on constrained networks.
- **Brand essence:** “A live event photo experience that turns each guest's moment into part of the room.” Personality: **cinematic, warm, composed**.
- **Brand voice:** direct and human, with short, confident cues. Example lines: “READY?” and “Your photo is now on the big screen.”
- **Wordmark & logo:** a custom six-square aperture mark paired with a tracked MOSAIC wordmark, implemented as a small original SVG/component rather than a default-font logo. Event-supplied logos can replace or accompany it.
- **Signature brand color:** warm copper/apricot, approximately `#E49A62`, used sparingly against ink and warm white.

## Frontend skill catalog reviewed

The requested [PyModel React Frontend Skills repository](https://github.com/PyModel/react-frontend-skills) and its README were inspected before implementation. The repository contains the 18 skills below; each was inspected in its `SKILL.md`, with task-specific references loaded where applicable. “Reviewed, not adopted” means the guidance was considered and the simpler existing stack was retained rather than adding a redundant dependency.

| Skill | Purpose in the repository | Project decision |
| --- | --- | --- |
| `react` | React 19 state, hooks, effects, and rendering patterns | Applied to capture state, subscriptions, cleanup, and components |
| `nextjs` | Next.js App Router, server components, caching, and routing | Reviewed; not used because the initialized application is Vite + Wouter |
| `typescript` | Type safety, compiler settings, and asynchronous/error patterns | Applied; project remains strict TypeScript |
| `tailwind` | Tailwind CSS v4 utilities, tokens, and animation patterns | Reviewed; precise screen layouts use the existing CSS pipeline and shared tokens |
| `shadcn` | Accessible Radix/Base UI primitives and component composition | Reviewed; existing starter primitives are reused; no extra component library is added |
| `ui-design` | Accessible, responsive user-interface and interaction design | Applied to distinct touch, fullscreen, and mobile experiences |
| `web-design-guidelines` | Review UI code against Vercel Web Interface Guidelines | Applied as a quality check for visible controls, contrast, and layout |
| `tanstack-query` | Data fetching, caching, mutations, and retries | Applied through the existing React Query/tRPC client |
| `react-hook-form` | Form state, validation, and efficient field updates | Applied to event branding forms |
| `zod` | Runtime schema validation and inferred types | Applied at shared API, realtime, event, and upload boundaries |
| `nuqs` | Typed URL query state for Next.js applications | Reviewed; omitted because Wouter/native search params plus Zod suffice |
| `vitest` | Unit tests, mocking, asynchronous checks, and workers | Applied to image decoding/normalization, event-scoped realtime, and bounded Mosaic state tests |
| `playwright` | Browser end-to-end selectors, authentication, and CI workflows | Applied as test guidance; the managed preview browser is used instead of adding a separate runner |
| `msw` | Mock Service Worker for isolated network/API tests | Reviewed; omitted because the actual managed API is available for integration and no extra mock dependency is needed |
| `tdd` | Test-first development methodology | Applied for deterministic state and upload-boundary regression cases |
| `feature-arch` | Feature-first folders, ownership, and module boundaries | Applied to Booth, Mosaic, Admin, Gallery, and server-side Mosaic modules |
| `vercel-composition-patterns` | Composable React components and explicit variants | Applied to shared brand and screen components without introducing complex abstractions |
| `vercel-react-best-practices` | React performance optimization and render behavior | Applied to bounded photo lists, ID sets, event queues, and effect cleanup |

No Next.js or URL-state dependency was added merely to mirror the catalog: this project is the existing Vite application, not a Next.js application.

## Build workflow

1. Keep the starter's React/Vite/Express/tRPC/Drizzle structure and establish the route manifest before starting the dev server. Add the event/photo/control schema and an additive migration; extend the public tRPC APIs, upload, SSE, and storage boundaries with strict validation and event isolation.
2. Implement the booth capture state machine and image preparation, then durable/idempotent upload and recoverable failure handling.
3. Implement the event-branded Mosaic opening, bounded square-tile wall, animated new-photo insertion, reconnect snapshot sync, and persisted controls.
4. Implement the explicitly public Admin workflows, booth presence, public event Gallery, direct photo links, share/download, and the optional QR flow. Keep branding centralized and all event data isolated by event ID.
5. Refine responsive and accessibility behavior for touch kiosks, mobile gallery, and fullscreen 1080p/1440p/4K Mosaic displays. Run the starter commands `pnpm check`, `pnpm test`, `pnpm build`, and `pnpm dev` from `/home/ubuntu/mosaic`; verify the health endpoint and route manifest, then exercise the requested photo journey and second-screen synchronization as far as the available camera/browser environment permits. Do not claim physical photo-byte deletion or successful camera hardware behavior unless verified.

The session's `runtime.post_edit` diagnostics are already registered for TypeScript. The project is configured for port 3000, with managed server and database enabled. No external realtime service or third-party credentials are required for the proposed SSE/database design. The project is not configured for automatic publication; implementation review will use Preview, and publication will not be enabled implicitly.
Use tRPC for typed public event-list/create/update, photo-list, Mosaic-control, and booth-presence APIs. Keep the streaming endpoint, binary photo upload, and attachment download as ordinary Express routes. `/admin` and its complete API surface are intentionally public: any visitor can create or select events, edit branding, pause/restart/clear a wall, or hide photos. The operator page must visibly warn users that its controls are public. Public writes and uploads receive generous per-process throttles, but those limits are not authentication or a substitute for shared edge/WAF rate limiting before a broad multi-instance launch. Booth, Mosaic, gallery, and all mutations remain scoped to a validated event ID; every photo is associated with an event and booth. Public event IDs are not access credentials. Booth presence is tracked separately from photo delivery so the operator can see recently connected booth devices.
