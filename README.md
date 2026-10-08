# Mosaic Live Event Photo Experience

React 19 / TypeScript / Vite client with an Express, tRPC, Drizzle, and MySQL server; built from the Manus Webdev `web-db-user` starter.

## Local development

- Requirements: Node.js 22, pnpm 10.18, a reachable MySQL-compatible database, and a server-side Manus Object Storage key for image uploads.
- Copy `.env.example` to `.env`, set `DATABASE_URL` and `MANUS_API_KEY`, and never commit the real `.env` file.
- Run `pnpm install --frozen-lockfile`, `pnpm db:migrate`, then `pnpm dev`.
- Open `http://localhost:3000`. The full Arabic local setup is in [LOCAL_SETUP_AR.md](LOCAL_SETUP_AR.md).
- `pnpm build` / `pnpm start` create and serve `dist/index.js` and `dist/public/`.
- `pnpm check` / `pnpm test` run TypeScript and application tests.

Without a valid `MANUS_API_KEY`, the UI and database-backed event controls can run, but photo and logo uploads cannot reach durable storage. The app does not yet include a local filesystem storage adapter.

## Run a live event

1. Open `/admin` without signing in. The entire admin surface is public by explicit product decision: any visitor can view active event names, create/select events, change branding, operate Mosaic controls, and hide photos. Do not treat the URL or event ID as a secret. Public writes and photo uploads have generous per-process burst limits, not authentication; use an equivalent shared edge/WAF limit before a broad multi-instance launch.
2. Open the generated `/booth?eventId=…` link on each camera device and `/mosaic?eventId=…` on the display. All booths for that event share the same Mosaic; another event uses a different event ID and has a separate photo stream.
3. Guests capture, preview, retake, and confirm. The kiosk compresses the photo and stores retry state locally if the network fails; the server decodes it, stores an optimized full image and thumbnail, and sends only metadata over the live event stream. A 2.5-second database snapshot reconciliation repairs missed updates across server processes without requiring a manual display refresh.
4. Share `/gallery/<eventId>` for photo preview, download, and share. Event galleries are public; event IDs are not authentication credentials.
5. `CLEAR` removes photos from the live wall without deleting stored files. `Delete photo` hides a photo from the Mosaic and gallery; the managed storage helper does not expose physical object deletion.

Guest Booth, display, gallery, and admin APIs carry a validated `eventId`; never reuse links between events. Event IDs scope data, but do not authorize actions.

## Project checks and routes

Before delivery or a managed checkpoint, run `pnpm check`, `pnpm test`, and `pnpm build`. The route declaration at `client/public/manus-routes.json` must match the client routes; `/api/health` is the runtime readiness endpoint. `pnpm db:migrate` applies checked-in schema changes.

Private keys stay server-side. The platform serves managed `/manus-storage/` assets; the application does not register a second proxy.
