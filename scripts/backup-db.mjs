#!/usr/bin/env node
/**
 * Pre-migration backup. Writes a full pg_dump of DATABASE_URL to
 * backups/technic-<timestamp>.sql. Run this BEFORE `npm run db:deploy`.
 *
 *   node scripts/backup-db.mjs
 *
 * Requires the `pg_dump` client tool (PostgreSQL client package). Neon users
 * can alternatively create a branch/snapshot from the Neon console.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set — nothing to back up.");
  process.exit(1);
}

mkdirSync("backups", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const file = path.join("backups", `technic-${stamp}.sql`);

const result = spawnSync("pg_dump", ["--no-owner", "--no-privileges", "--file", file, url], { stdio: "inherit" });
if (result.error || result.status !== 0) {
  console.error("pg_dump failed — install the PostgreSQL client tools or take a snapshot in your provider's console.");
  process.exit(result.status ?? 1);
}
console.log(`Backup written to ${file}`);
