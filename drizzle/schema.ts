import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { EventBranding, EventSettings } from "../shared/mosaic";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  openId: text("openId").notNull().unique(),
  name: text("name"),
  email: text("email"),
  loginMethod: text("loginMethod"),
  role: text("role").default("user").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`).notNull(),
  lastSignedIn: integer("lastSignedIn", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`).notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  ownerOpenId: text("ownerOpenId"),
  name: text("name").notNull(),
  logoUrl: text("logoUrl"),
  branding: text("branding", { mode: "json" }).$type<EventBranding>().notNull(),
  settings: text("settings", { mode: "json" }).$type<EventSettings>().notNull(),
  isActive: integer("isActive", { mode: "boolean" }).default(true).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`).notNull(),
});

export const booths = sqliteTable("booths", {
  id: text("id").primaryKey(),
  eventId: text("eventId").notNull(),
  label: text("label"),
  lastSeenAt: integer("lastSeenAt", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`).notNull(),
});

export const photos = sqliteTable("photos", {
  id: text("id").primaryKey(),
  eventId: text("eventId").notNull(),
  boothId: text("boothId").notNull(),
  imageUrl: text("imageUrl").notNull(),
  thumbnailUrl: text("thumbnailUrl").notNull(),
  mosaicVisible: integer("mosaicVisible", { mode: "boolean" }).default(true).notNull(),
  hiddenAt: integer("hiddenAt", { mode: "timestamp" }),
  createdAt: integer("createdAt", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`).notNull(),
});

export const mosaicStates = sqliteTable("mosaicStates", {
    eventId: text("eventId").primaryKey(),
    playing: integer("playing", { mode: "boolean" }).default(true).notNull(),
    revision: integer("revision").default(0).notNull(),
    restartKey: integer("restartKey").default(0).notNull(),
    autoFill: integer("autoFill", { mode: "boolean" }).default(false).notNull(),
    screensaver: integer("screensaver", { mode: "boolean" }).default(false).notNull(),
    frozenPhotoCount: integer("frozenPhotoCount").default(0).notNull(),
    targetIndex: integer("targetIndex").default(0).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`).notNull(),
});

export type EventRecord = typeof events.$inferSelect;
export type PhotoRecord = typeof photos.$inferSelect;
export type BoothRecord = typeof booths.$inferSelect;
export type MosaicStateRecord = typeof mosaicStates.$inferSelect;

