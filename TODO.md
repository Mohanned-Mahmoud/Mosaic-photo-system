# Mosaic Live Event Photo Experience — Project TODO

Native todo actions are not available in this initialized Webdev toolset, so this file preserves the full outcome criteria required by the Webdev workflow. All outcomes begin open; mark an item complete only after its behavior is implemented and supported by evidence.

**User-approved security override (2026-10-08):** make `/admin` and all event/photo control APIs publicly accessible without sign-in. Any visitor can create/select events, change branding, operate Mosaic controls, and hide photos. Keep event-ID validation and event isolation; event IDs are not authorization credentials. This explicit decision supersedes the original “secure administrative operations” clause below, which is retained verbatim for traceability; other file/input validation requirements remain in force.

- [ ] **Guest Photo Booth — routes, camera, countdown, preview, and confirmation**
  - Create these primary routes: `/booth`, `/mosaic`, `/admin`, `/gallery/[eventId]`.
  - `/booth` is guest-facing. The Photo Booth must be extremely simple. The guest should understand the experience immediately.
  - Initial state displays **READY?** and a large primary button **TAKE PHOTO**. The interface is touch-friendly and visually premium.
  - Use browser camera APIs. Request camera permission; show live camera preview; support front-facing camera where available; mirror preview when appropriate; capture high-quality images; handle camera permission errors and unavailable cameras; allow camera retry; avoid exposing unnecessary browser controls. The camera should occupy most of the screen.
  - When the guest presses TAKE PHOTO, show a cinematic countdown `3`, `2`, `1`. The numbers are large and animated, with smooth scale/fade transitions; do not use an ugly default countdown.
  - After capture, display the captured photo with two large controls, `RETAKE` and `USE PHOTO`. RETAKE returns immediately to the camera. USE PHOTO continues to upload.
  - After successfully uploading the photo, display a short confirmation such as **YOUR PHOTO IS NOW ON THE BIG SCREEN**, then automatically return to the camera after a short delay. The guest never needs to manually reset the booth. The complete interaction is fast enough for continuous event usage.

- [ ] **Live Mosaic — fullscreen wall, opening, and incoming-photo animation**
  - `/mosaic` is a fullscreen live display for TV, LED screen, projector, large monitor, or event display. It has no navigation, browser-like UI, or unnecessary controls.
  - The Mosaic visual concept is **a living wall of event memories that continuously builds itself**. Use a dense grid of square photo tiles. Tiles are square, consistently sized, closely spaced, properly cropped, visually aligned, and the layout adapts to screen dimensions.
  - When the Mosaic first loads, show a branded opening state with the event logo centered, introduce the photo grid subtly behind it, then transition naturally into the active Mosaic. The opening feels cinematic.
  - When a new photo is received, do not instantly append it to the grid. Animate it into the Mosaic: it enters from the top, moves down, interacts with the grid, settles into place, and becomes part of the wall. The motion feels physical and smooth and uses transform, translate, scale, opacity, and carefully tuned easing. Avoid unnecessary layout thrashing.
  - The Mosaic should not feel frozen when no new photos arrive. Create subtle ambient movement such as gentle photo movement, periodic logo reveal, subtle grid transitions, cinematic transitions, or occasional visual refresh. Do not aggressively shuffle the entire wall. Motion is premium, controlled, and intentional.

- [ ] **Event logo, branding, and future logo-mosaic capability**
  - The logo is configurable per event and supports logo upload, transparent PNG/SVG, logo sizing, logo position, and optional logo animation. The logo appears as part of the experience rather than a static watermark. A reveal/display/transition sequence may return naturally to the Mosaic; do not overuse the logo.
  - Each event has `eventId`, `eventName`, `logo`, `branding`, `photos`, `createdAt`, and `settings`. Centralized event branding controls event name, logo, background, primary color, accent color, tile spacing, Mosaic animation speed, logo animation, and theme. Do not hardcode branding values throughout the application.
  - The architecture makes creating a new event easy and allows separate events such as `/event/faivent2026`, `/event/company-event-2026`, or `/event/dallah-2026` without sharing photos.
  - The advanced Mosaic-to-logo feature does not need to be part of the first MVP if it significantly complicates the architecture; structure the Mosaic engine so it can be added later without rewriting the entire system. Potential future behavior is hundreds of photos → Mosaic transition → photos align → logo forms → logo holds → Mosaic returns.

- [ ] **Real-time communication, multi-booth support, and event isolation**
  - `/booth` and `/mosaic` communicate in real time. Use an appropriate production-ready solution such as WebSockets, Socket.IO, Supabase Realtime, Firebase, or another reliable architecture; choose the simplest robust implementation.
  - The actual flow is: Booth device → upload photo → create photo record → emit real-time event → Mosaic device → receive photo event → run Mosaic animation. The Mosaic updates without refreshing.
  - Support multiple booths belonging to the same event. All such booths send photos to the same event Mosaic. Each booth has an identifier such as `boothId` and `eventId`; do not tightly couple the Mosaic to a single booth.
  - Every photo belongs to a specific event. Never mix photos between events. The architecture supports easy creation of additional events.

- [ ] **Durable photo storage and optimized image pipeline**
  - Implement real photo storage. A photo record contains at minimum `id`, `eventId`, `imageUrl`, `createdAt`, and `boothId`.
  - Store photos using an appropriate storage solution; do not rely only on localStorage. Do not transmit large image blobs repeatedly through real-time messages. Real-time messages preferably contain lightweight metadata and image references.
  - Optimize images for live events: resize appropriately; compress uploads; maintain visual quality; generate appropriate thumbnail sizes; crop consistently for Mosaic tiles; avoid unnecessarily huge files; cache images appropriately.
  - The Mosaic remains performant with hundreds or thousands of photos.

- [ ] **Public event gallery and guest QR access**
  - Implement `/gallery/[eventId]` to show event photos. Each photo supports preview, download, and share. The gallery is mobile-friendly.
  - After the guest confirms a photo, optionally display a QR code that opens the guest’s photo or a simple photo page. Keep this experience extremely simple and do not block the Mosaic upload while generating the QR experience.
  - The optional confirmation can show `YOUR PHOTO IS READY`, the photo, `SCAN TO GET YOUR PHOTO`, and a QR code.

- [ ] **Operator Admin — event management, photo actions, and Mosaic controls**
  - Create a simple `/admin` interface. The operator can create an event; select an event; upload/change logo; change branding; view photo count; view connected booths; clear Mosaic; delete photos; restart Mosaic; pause/resume animation; view gallery; and reset event session. Prioritize functionality over visual complexity.
  - Provide Mosaic controls `PLAY`, `PAUSE`, `RESTART`, and `CLEAR`.
  - When CLEAR is triggered, clear the active Mosaic state; do not necessarily delete stored photos unless explicitly requested; make the behavior safe and reversible where practical.
  - **Approved storage behavior for Delete photo:** deletion is a soft-delete/hide operation in application views. It removes the image from the Mosaic and gallery and hides it from ordinary application queries, while the underlying managed-storage bytes remain. The app must not describe this as physical erasure.

- [ ] **Connection resilience, recovery, and duplicate protection**
  - Network failures do not destroy the live-event experience. If the real-time connection drops, reconnect automatically, synchronize the current event, and recover missed photos. The Mosaic continues displaying existing photos while disconnected. The booth handles failed uploads gracefully and, if practical, temporarily queues failed uploads and retries them.
  - Every photo has a unique ID. The Mosaic never inserts the same photo twice. If the same real-time event arrives more than once and the photo already exists, ignore the event.

- [ ] **Long-running performance and device-specific responsive behavior**
  - The system may run continuously for several hours. Prevent memory leaks, excessive React renders, unbounded image memory, animation performance problems, uncleaned event listeners or WebSocket/SSE connections, stale subscriptions, unnecessary API requests, and large unbounded DOM trees. The Mosaic must not become progressively slower as photos arrive. Use virtualization, canvas rendering, DOM recycling, or another technique if required by measured needs; choose based on actual needs rather than adding premature complexity.
  - Photo Booth supports touchscreen, portrait, landscape, and different camera aspect ratios; controls remain large and accessible.
  - Mosaic prioritizes fullscreen 1920×1080, 2560×1440, and 3840×2160 displays and always fills the available display.

- [ ] **Premium visual design, accessibility, security, and modular code**
  - The application looks premium and avoids the appearance of a generic admin template, SaaS dashboard, coding demo, default Tailwind template, or generic AI-generated UI. Use confident typography, intentional spacing, restrained color, smooth transitions, strong composition, cinematic motion, and high-quality event imagery. The Mosaic is the visual hero; the Booth is minimal and easy to use; the Admin is more functional.
  - Use semantic HTML, accessible controls, visible interaction states, keyboard support where appropriate, and sufficient contrast. The Photo Booth prioritizes touch interaction.
  - Implement production security: never expose private credentials; use environment variables; validate uploaded files, file types, file sizes, event identifiers, and API input; do not expose unrestricted storage/database access.
  - Keep the application modular. Adapt the suggested structure to the actual framework: separate booth, mosaic, admin, and gallery; reusable camera/countdown/photo-preview/mosaic-tile/logo/QR/event-branding components; client realtime/storage/image/event/validation logic; server photos/events/realtime logic. Do not blindly follow a structure if the chosen framework has a better architecture.

- [ ] **Verified real end-to-end capture-to-Mosaic experience**
  - Do not stop after creating the UI. A beautiful frontend with fake data is not complete. The following must actually work: CAMERA → CAPTURE → UPLOAD → STORAGE → REALTIME EVENT → MOSAIC → ANIMATION.
  - Before declaring the application complete, test the source-requested behavior: (1) open `/booth` and verify camera behavior; (2) capture a photo and verify preview; (3) verify retake; (4) confirm photo and verify successful upload; (5) open `/mosaic` on another device/browser and verify the new photo appears automatically; (6) take multiple photos quickly and verify no duplicates; (7) refresh Mosaic and verify existing photos remain synchronized; (8) disconnect/reconnect network and verify recovery; (9) run the Mosaic for an extended period and verify no obvious memory/performance degradation; (10) test on 1920×1080 and verify the Mosaic fills the screen correctly.
  - Final acceptance: a real person can open Photo Booth, take a photo, confirm it, see confirmation, look at a second screen, watch their photo animate into the Mosaic, take another photo, and watch another photo join the wall.
  - Final operator acceptance: create event → configure branding → open Mosaic → connect multiple booths → run event → monitor photos → control Mosaic.
  - The final result feels like a professional product deployable at a real corporate event, wedding, conference, activation, exhibition, or brand experience. When adding more features conflicts with perfecting the core experience, perfect the core experience first: **TAKE A PHOTO → WATCH IT COME ALIVE ON THE BIG SCREEN.**
