import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerMosaicHttpRoutes } from "../mosaic/http";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerStorageProxy } from "./storageProxy";

export async function createApp() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ limit: "2mb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  
  registerStorageProxy(app);
  registerMosaicHttpRoutes(app);

  app.use(
    "/api/trpc",
    createExpressMiddleware({ router: appRouter, createContext }),
  );
  app.use((error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    console.error("Request failed:", error.message);
    if (!response.headersSent) response.status(500).json({ error: "The request could not be completed" });
  });

  return app;
}

async function startServer() {
  const app = await createApp();
  const server = createServer(app);

  if (process.env.NODE_ENV !== "production") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); });
  server.listen(port, "0.0.0.0", () => console.log(`Server listening on port ${port}`));
}

if (!process.env.VERCEL) {
  startServer().catch(error => { console.error(error); process.exit(1); });
}
