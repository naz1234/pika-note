CREATE TABLE `note_images` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`owner` text NOT NULL,
	`object_key` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `note_images_note_owner_idx` ON `note_images` (`note_id`,`owner`);--> statement-breakpoint
CREATE UNIQUE INDEX `note_images_object_key_idx` ON `note_images` (`object_key`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`color` text DEFAULT 'yellow' NOT NULL,
	`is_pinned` integer DEFAULT false NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notes_owner_archive_updated_idx` ON `notes` (`owner`,`is_archived`,`updated_at`);--> statement-breakpoint
CREATE INDEX `notes_owner_pinned_updated_idx` ON `notes` (`owner`,`is_pinned`,`updated_at`);