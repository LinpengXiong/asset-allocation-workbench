CREATE TABLE `dataset_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`as_of` text NOT NULL,
	`collected_at` text NOT NULL,
	`status` text NOT NULL,
	`payload_json` text NOT NULL,
	`checksum` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dataset_versions_checksum_unique` ON `dataset_versions` (`checksum`);--> statement-breakpoint
CREATE INDEX `dataset_versions_collected_at_idx` ON `dataset_versions` (`collected_at`,`id`);