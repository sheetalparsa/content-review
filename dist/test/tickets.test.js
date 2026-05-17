import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import { seedIfEmpty } from "../src/seed.js";
import { upsertReviewer } from "../src/auth.js";
import { confirmTicket, listAvailableTickets, reserveTicket, releaseExpiredReservations } from "../src/tickets.js";
describe("ticket flow", () => {
    it("enforces locale scoping for reserve", () => {
        const db = openDb(":memory:");
        seedIfEmpty(db);
        upsertReviewer(db, { reviewer_id: "w1", locale: "west-coast" });
        upsertReviewer(db, { reviewer_id: "e1", locale: "east-coast" });
        const westTicket = listAvailableTickets(db, "west-coast", 1)[0];
        expect(westTicket).toBeTruthy();
        const wrong = reserveTicket(db, { reviewer_id: "e1", locale: "east-coast" }, westTicket.id);
        expect(wrong.ok).toBe(false);
        if (!wrong.ok)
            expect(wrong.error).toBe("wrong_locale");
    });
    it("rejects confirm when reservation expired (and ticket becomes OPEN again)", () => {
        const db = openDb(":memory:");
        seedIfEmpty(db);
        upsertReviewer(db, { reviewer_id: "w1", locale: "west-coast" });
        const t = listAvailableTickets(db, "west-coast", 1)[0];
        const r = reserveTicket(db, { reviewer_id: "w1", locale: "west-coast" }, t.id);
        expect(r.ok).toBe(true);
        const now = Date.now();
        releaseExpiredReservations(db, now + 60 * 60 * 1000);
        const out = confirmTicket(db, { reviewer_id: "w1", locale: "west-coast" }, t.id);
        expect(out.ok).toBe(false);
        if (!out.ok)
            expect(out.error).toMatch(/reservation_(expired|not_active)|ticket_not_reserved|confirm_failed/);
        const availableAgain = listAvailableTickets(db, "west-coast", 50);
        expect(availableAgain.some((x) => x.id === t.id)).toBe(true);
    });
});
