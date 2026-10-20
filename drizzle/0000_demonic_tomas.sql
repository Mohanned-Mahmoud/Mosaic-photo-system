CREATE TABLE `booths` (
	`id` text PRIMARY KEY NOT NULL,
	`eventId` text NOT NULL,
	`label` text,
	`lastSeenAt` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`createdAt` integer DEFAULT (strftime('%s', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerOpenId` text,
	`name` text NOT NULL,
	`logoUrl` text,
	`branding` text NOT NULL,
	`settings` text NOT NULL,
	`isActive` integer DEFAULT true NOT NULL,
	`createdAt` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updatedAt` integer DEFAULT (strftime('%s', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mosaicStates` (
	`eventId` text PRIMARY KEY NOT NULL,
	`playing` integer DEFAULT true NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`restartKey` integer DEFAULT 0 NOT NULL,
	`updatedAt` integer DEFAULT (strftime('%s', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`eventId` text NOT NULL,
	`boothId` text NOT NULL,
	`imageUrl` text NOT NULL,
	`thumbnailUrl` text NOT NULL,
	`mosaicVisible` integer DEFAULT true NOT NULL,
	`hiddenAt` integer,
	`createdAt` integer DEFAULT (strftime('%s', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`openId` text NOT NULL,
	`name` text,
	`email` text,
	`loginMethod` text,
	`role` text DEFAULT 'user' NOT NULL,
	`createdAt` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updatedAt` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`lastSignedIn` integer DEFAULT (strftime('%s', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_openId_unique` ON `users` (`openId`);