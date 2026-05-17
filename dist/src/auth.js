import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "./config.js";
export const loginBodySchema = z.object({
    reviewer_id: z.string().min(1),
    locale: z.enum(["west-coast", "east-coast", "midwest", "south"])
});
export function issueToken(reviewer) {
    return jwt.sign({ locale: reviewer.locale }, config.jwtSecret, {
        subject: reviewer.reviewer_id,
        expiresIn: "24h"
    });
}
export function upsertReviewer(db, reviewer) {
    const now = Date.now();
    db.prepare(`INSERT INTO reviewers (reviewer_id, locale, created_at_ms)
     VALUES (?, ?, ?)
     ON CONFLICT(reviewer_id) DO UPDATE SET locale=excluded.locale`).run(reviewer.reviewer_id, reviewer.locale, now);
}
export function requireAuth(req, res, next) {
    const hdr = req.header("authorization") || "";
    const m = hdr.match(/^Bearer\s+(.+)$/i);
    if (!m)
        return res.status(401).json({ error: "missing_bearer_token" });
    try {
        const decoded = jwt.verify(m[1], config.jwtSecret);
        const reviewer_id = decoded.sub;
        const locale = decoded.locale;
        if (typeof reviewer_id !== "string" || typeof locale !== "string") {
            return res.status(401).json({ error: "invalid_token" });
        }
        req.reviewer = { reviewer_id, locale };
        next();
    }
    catch {
        return res.status(401).json({ error: "invalid_token" });
    }
}
