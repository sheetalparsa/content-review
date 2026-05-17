import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db.js";
import { config } from "./config.js";

export type TicketRow = {
  ticket_id: string;
  locale: string;
  title: string;
  body: string | null;
  status: "OPEN" | "RESERVED" | "IN_PROGRESS";
  current_reservation_id: string | null;
  created_at_ms: number;
  updated_at_ms: number;
};

export const reserveParamsSchema = z.object({
  id: z.string().min(1)
});

export function releaseExpiredReservations(db: Db, nowMs = Date.now()) {
  const findExpired = db.prepare(
    `SELECT reservation_id, ticket_id
     FROM reservations
     WHERE released_at_ms IS NULL
       AND confirmed_at_ms IS NULL
       AND expires_at_ms <= ?`
  );
  const expired = findExpired.all(nowMs) as Array<{ reservation_id: string; ticket_id: string }>;
  if (expired.length === 0) return { released: 0 };

  const markReleased = db.prepare(
    `UPDATE reservations
        SET released_at_ms = ?
      WHERE reservation_id = ?
        AND released_at_ms IS NULL
        AND confirmed_at_ms IS NULL`
  );
  const reopenTicket = db.prepare(
    `UPDATE tickets
       SET status='OPEN', current_reservation_id=NULL, updated_at_ms=?
     WHERE ticket_id=? AND status='RESERVED' AND current_reservation_id=?`
  );

  const tx = db.transaction(() => {
    let released = 0;
    for (const r of expired) {
      const a = markReleased.run(nowMs, r.reservation_id).changes;
      const b = reopenTicket.run(nowMs, r.ticket_id, r.reservation_id).changes;
      if (a && b) released++;
    }
    return { released };
  });
  return tx();
}

export function listAvailableTickets(db: Db, locale: string, limit = 10) {
  releaseExpiredReservations(db);
  const rows = db
    .prepare(
      `SELECT ticket_id, locale, title, body, status, current_reservation_id, created_at_ms, updated_at_ms
       FROM tickets
       WHERE locale = ?
         AND status = 'OPEN'
       ORDER BY created_at_ms ASC
       LIMIT ?`
    )
    .all(locale, limit) as TicketRow[];

  return rows.map((r) => ({
    id: r.ticket_id,
    locale: r.locale,
    title: r.title,
    body: r.body
  }));
}

export function listMyTickets(db: Db, reviewer: { reviewer_id: string; locale: string }) {
  releaseExpiredReservations(db);
  const rows = db
    .prepare(
      `SELECT
         t.ticket_id,
         t.locale,
         t.title,
         t.body,
         t.status,
         r.reservation_id,
         r.expires_at_ms,
         r.confirmed_at_ms
       FROM tickets t
       JOIN reservations r ON r.reservation_id = t.current_reservation_id
       WHERE r.reviewer_id = ?
         AND t.locale = ?
         AND r.released_at_ms IS NULL
         AND t.status IN ('RESERVED','IN_PROGRESS')
       ORDER BY r.reserved_at_ms DESC`
    )
    .all(reviewer.reviewer_id, reviewer.locale) as Array<{
    ticket_id: string;
    locale: string;
    title: string;
    body: string | null;
    status: string;
    reservation_id: string;
    expires_at_ms: number;
    confirmed_at_ms: number | null;
  }>;

  return rows.map((r) => ({
    id: r.ticket_id,
    locale: r.locale,
    title: r.title,
    body: r.body,
    status: r.status,
    reservation_id: r.reservation_id,
    expires_at_ms: r.expires_at_ms,
    confirmed_at_ms: r.confirmed_at_ms
  }));
}

export function reserveTicket(db: Db, reviewer: { reviewer_id: string; locale: string }, ticketId: string) {
  const now = Date.now();
  const expiresAt = now + config.reservationTtlSeconds * 1000;
  const reservationId = `res_${randomUUID()}`;

  const getTicket = db.prepare(
    `SELECT ticket_id, locale, status, current_reservation_id FROM tickets WHERE ticket_id = ?`
  );
  const insertReservation = db.prepare(
    `INSERT INTO reservations (reservation_id, ticket_id, reviewer_id, locale, reserved_at_ms, expires_at_ms, confirmed_at_ms, released_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`
  );
  const updateTicket = db.prepare(
    `UPDATE tickets
       SET status='RESERVED', current_reservation_id=?, updated_at_ms=?
     WHERE ticket_id=? AND status='OPEN' AND locale=?`
  );

  const tx = db.transaction(() => {
    releaseExpiredReservations(db, now);

    const t = getTicket.get(ticketId) as
      | { ticket_id: string; locale: string; status: string; current_reservation_id: string | null }
      | undefined;
    if (!t) return { ok: false as const, status: 404, error: "ticket_not_found" };
    if (t.locale !== reviewer.locale) return { ok: false as const, status: 403, error: "wrong_locale" };
    if (t.status !== "OPEN") return { ok: false as const, status: 409, error: "ticket_not_available" };

    const changes = updateTicket.run(reservationId, now, ticketId, reviewer.locale).changes;
    if (changes !== 1) return { ok: false as const, status: 409, error: "ticket_not_available" };

    insertReservation.run(reservationId, ticketId, reviewer.reviewer_id, reviewer.locale, now, expiresAt);

    return {
      ok: true as const,
      reservation: {
        reservation_id: reservationId,
        ticket_id: ticketId,
        reviewer_id: reviewer.reviewer_id,
        locale: reviewer.locale,
        reserved_at_ms: now,
        expires_at_ms: expiresAt
      }
    };
  });

  try {
    return tx();
  } catch {
    return { ok: false as const, status: 500, error: "reserve_failed" };
  }
}

export function confirmTicket(db: Db, reviewer: { reviewer_id: string; locale: string }, ticketId: string) {
  const now = Date.now();
  const getTicket = db.prepare(
    `SELECT ticket_id, locale, status, current_reservation_id FROM tickets WHERE ticket_id=?`
  );
  const getReservation = db.prepare(
    `SELECT reservation_id, reviewer_id, locale, expires_at_ms, confirmed_at_ms, released_at_ms
     FROM reservations WHERE reservation_id=?`
  );
  const markConfirmed = db.prepare(
    `UPDATE reservations SET confirmed_at_ms=? WHERE reservation_id=? AND confirmed_at_ms IS NULL AND released_at_ms IS NULL`
  );
  const setInProgress = db.prepare(
    `UPDATE tickets SET status='IN_PROGRESS', updated_at_ms=? WHERE ticket_id=? AND status='RESERVED' AND current_reservation_id=?`
  );

  const tx = db.transaction(() => {
    releaseExpiredReservations(db, now);

    const t = getTicket.get(ticketId) as
      | { ticket_id: string; locale: string; status: string; current_reservation_id: string | null }
      | undefined;
    if (!t) return { ok: false as const, status: 404, error: "ticket_not_found" };
    if (t.locale !== reviewer.locale) return { ok: false as const, status: 403, error: "wrong_locale" };
    if (t.status !== "RESERVED" || !t.current_reservation_id) {
      return { ok: false as const, status: 409, error: "ticket_not_reserved" };
    }

    const r = getReservation.get(t.current_reservation_id) as
      | {
          reservation_id: string;
          reviewer_id: string;
          locale: string;
          expires_at_ms: number;
          confirmed_at_ms: number | null;
          released_at_ms: number | null;
        }
      | undefined;
    if (!r || r.released_at_ms) return { ok: false as const, status: 409, error: "reservation_not_active" };
    if (r.reviewer_id !== reviewer.reviewer_id) return { ok: false as const, status: 403, error: "not_reserver" };
    if (r.expires_at_ms <= now) return { ok: false as const, status: 409, error: "reservation_expired" };
    if (r.confirmed_at_ms) return { ok: false as const, status: 409, error: "already_confirmed" };

    const a = markConfirmed.run(now, r.reservation_id).changes;
    const b = setInProgress.run(now, ticketId, r.reservation_id).changes;
    if (!a || !b) throw new Error("confirm_failed");

    return { ok: true as const, ticket: { ticket_id: ticketId, status: "IN_PROGRESS", confirmed_at_ms: now } };
  });

  try {
    return tx();
  } catch {
    return { ok: false as const, status: 409, error: "confirm_failed" };
  }
}

export function getMetrics(db: Db) {
  releaseExpiredReservations(db);
  const ticketCounts = db
    .prepare(`SELECT status, COUNT(*) as c FROM tickets GROUP BY status`)
    .all() as Array<{ status: string; c: number }>;

  const reservationCounts = db
    .prepare(
      `SELECT
        SUM(CASE WHEN confirmed_at_ms IS NOT NULL THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN released_at_ms IS NOT NULL THEN 1 ELSE 0 END) as released,
        COUNT(*) as total
       FROM reservations`
    )
    .get() as { confirmed: number; released: number; total: number };

  const byStatus = Object.fromEntries(ticketCounts.map((r) => [r.status, r.c]));

  return {
    tickets: {
      open: byStatus.OPEN || 0,
      reserved: byStatus.RESERVED || 0,
      in_progress: byStatus.IN_PROGRESS || 0,
      total: Object.values(byStatus).reduce((a, b) => a + b, 0)
    },
    reservations: reservationCounts
  };
}
