import { index, integer, json, pgEnum, pgTable, text, timestamp, varchar, boolean, serial } from "drizzle-orm/pg-core";
import type { EventBranding, EventSettings } from "../shared/mosaic";

export const roleEnum = pgEnum("role", ["user", "admin"]);

/** Manus OAuth users. The starter's identity and role behavior remain unchanged. */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdateFn(() => new Date()).notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** Publicly managed event data; the nullable creator field only preserves legacy records. */
export const events = pgTable(
  "events",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    ownerOpenId: varchar("ownerOpenId", { length: 64 }),
    name: varchar("name", { length: 100 }).notNull(),
    logoUrl: text("logoUrl"),
    branding: json("branding").$type<EventBranding>().notNull(),
    settings: json("settings").$type<EventSettings>().notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdateFn(() => new Date()).notNull(),
  },
  table => [index("events_owner_openId_idx").on(table.ownerOpenId)],
);

/** Booth presence is indexed per event; no user credential is stored on the booth. */
export const booths = pgTable(
  "booths",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    eventId: varchar("eventId", { length: 32 }).notNull(),
    label: varchar("label", { length: 80 }),
    lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("booths_event_idx").on(table.eventId), index("booths_last_seen_idx").on(table.eventId, table.lastSeenAt)],
);

/** Image bytes are in managed object storage; this table holds references and moderation state. */
export const photos = pgTable(
  "photos",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    eventId: varchar("eventId", { length: 32 }).notNull(),
    boothId: varchar("boothId", { length: 36 }).notNull(),
    imageUrl: text("imageUrl").notNull(),
    thumbnailUrl: text("thumbnailUrl").notNull(),
    mosaicVisible: boolean("mosaicVisible").default(true).notNull(),
    hiddenAt: timestamp("hiddenAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("photos_event_created_idx").on(table.eventId, table.createdAt),
    index("photos_event_mosaic_idx").on(table.eventId, table.mosaicVisible, table.createdAt),
    index("photos_event_hidden_idx").on(table.eventId, table.hiddenAt, table.createdAt),
  ],
);

/** Per-event persisted operator intent; restartKey replays the branded opening without deleting data. */
export const mosaicStates = pgTable("mosaicStates", {
    eventId: varchar("eventId", { length: 32 }).primaryKey(),
    playing: boolean("playing").default(true).notNull(),
    revision: integer("revision").default(0).notNull(),
    restartKey: integer("restartKey").default(0).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdateFn(() => new Date()).notNull(),
});

export type EventRecord = typeof events.$inferSelect;
export type PhotoRecord = typeof photos.$inferSelect;
export type BoothRecord = typeof booths.$inferSelect;
export type MosaicStateRecord = typeof mosaicStates.$inferSelect;

