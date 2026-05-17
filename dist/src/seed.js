import { randomUUID } from "node:crypto";
const LOCALES = ["west-coast", "east-coast", "midwest", "south"];
export function seedIfEmpty(db) {
    const row = db.prepare("SELECT COUNT(*) as c FROM tickets").get();
    if (row.c > 0)
        return;
    const now = Date.now();
    const insert = db.prepare(`INSERT INTO tickets (ticket_id, locale, title, body, status, current_reservation_id, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, 'OPEN', NULL, ?, ?)`);
    const tx = db.transaction(() => {
        let i = 0;
        for (const locale of LOCALES) {
            for (let j = 0; j < 12; j++) {
                i++;
                const id = `t_${locale}_${String(j + 1).padStart(3, "0")}_${randomUUID().slice(0, 8)}`;
                insert.run(id, locale, `Ticket ${i} (${locale})`, `Generated seed ticket ${i} for locale ${locale}.`, now, now);
            }
        }
    });
    tx();
}
