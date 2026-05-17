import { describe, expect, it } from "vitest";
import { config as appConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { seedIfEmpty } from "../src/seed.js";
import { upsertReviewer } from "../src/auth.js";
import { listAvailableTickets, reserveTicket, releaseExpiredReservations } from "../src/tickets.js";
describe("reservation expiry", () => {
    it("releases unconfirmed reservations after TTL", () => {
        const oldTtl = appConfig.reservationTtlSeconds;
        appConfig.reservationTtlSeconds = 2;
        const db = openDb(":memory:");
        seedIfEmpty(db);
        upsertReviewer(db, { reviewer_id: "r1", locale: "west-coast" });
        const available1 = listAvailableTickets(db, "west-coast", 1);
        expect(available1.length).toBe(1);
        const reserve = reserveTicket(db, { reviewer_id: "r1", locale: "west-coast" }, available1[0].id);
        expect(reserve.ok).toBe(true);
        const available2 = listAvailableTickets(db, "west-coast", 50);
        expect(available2.find((t) => t.id === available1[0].id)).toBeUndefined();
        const now = Date.now();
        releaseExpiredReservations(db, now + 3000);
        const available3 = listAvailableTickets(db, "west-coast", 50);
        expect(available3.find((t) => t.id === available1[0].id)).toBeTruthy();
        appConfig.reservationTtlSeconds = oldTtl;
    });
});
