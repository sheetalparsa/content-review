import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";
export function openDb(dbPath = config.dbPath) {
    if (dbPath !== ":memory:") {
        mkdirSync(dirname(dbPath), { recursive: true });
    }
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    migrate(db);
    return db;
}
function migrate(db) {
    db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS reviewers (
      reviewer_id TEXT PRIMARY KEY,
      locale TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tickets (
      ticket_id TEXT PRIMARY KEY,
      locale TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      status TEXT NOT NULL CHECK (status IN ('OPEN','RESERVED','IN_PROGRESS')),
      current_reservation_id TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reservations (
      reservation_id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      reviewer_id TEXT NOT NULL,
      locale TEXT NOT NULL,
      reserved_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      confirmed_at_ms INTEGER,
      released_at_ms INTEGER,
      FOREIGN KEY (ticket_id) REFERENCES tickets(ticket_id),
      FOREIGN KEY (reviewer_id) REFERENCES reviewers(reviewer_id)
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_locale_status ON tickets(locale, status);
    CREATE INDEX IF NOT EXISTS idx_reservations_ticket ON reservations(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_reservations_expires ON reservations(expires_at_ms);
    CREATE INDEX IF NOT EXISTS idx_reservations_released ON reservations(released_at_ms);
  `);
}
