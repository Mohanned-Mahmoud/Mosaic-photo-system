import type { Express } from "express";
import express from "express";
import path from "path";

export function registerStorageProxy(app: Express) {
  const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads");
  app.use("/local-storage", express.static(UPLOADS_DIR));
}
