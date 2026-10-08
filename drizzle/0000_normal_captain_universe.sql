CREATE TYPE "public"."role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "booths" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"eventId" varchar(32) NOT NULL,
	"label" varchar(80),
	"lastSeenAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"ownerOpenId" varchar(64),
	"name" varchar(100) NOT NULL,
	"logoUrl" text,
	"branding" json NOT NULL,
	"settings" json NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mosaicStates" (
	"eventId" varchar(32) PRIMARY KEY NOT NULL,
	"playing" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"restartKey" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"eventId" varchar(32) NOT NULL,
	"boothId" varchar(36) NOT NULL,
	"imageUrl" text NOT NULL,
	"thumbnailUrl" text NOT NULL,
	"mosaicVisible" boolean DEFAULT true NOT NULL,
	"hiddenAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE INDEX "booths_event_idx" ON "booths" USING btree ("eventId");--> statement-breakpoint
CREATE INDEX "booths_last_seen_idx" ON "booths" USING btree ("eventId","lastSeenAt");--> statement-breakpoint
CREATE INDEX "events_owner_openId_idx" ON "events" USING btree ("ownerOpenId");--> statement-breakpoint
CREATE INDEX "photos_event_created_idx" ON "photos" USING btree ("eventId","createdAt");--> statement-breakpoint
CREATE INDEX "photos_event_mosaic_idx" ON "photos" USING btree ("eventId","mosaicVisible","createdAt");--> statement-breakpoint
CREATE INDEX "photos_event_hidden_idx" ON "photos" USING btree ("eventId","hiddenAt","createdAt");