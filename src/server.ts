import express from "express";
import cors from "cors";
import morgan from "morgan";
import { z } from "zod";
import { config } from "./config.js";
import { openDb } from "./db.js";
import { seedIfEmpty } from "./seed.js";
import { issueToken, loginBodySchema, requireAuth, upsertReviewer, type AuthedRequest } from "./auth.js";
import { confirmTicket, getMetrics, listAvailableTickets, listMyTickets, reserveTicket, releaseExpiredReservations } from "./tickets.js";

const db = openDb();
if (config.seedOnStartup) seedIfEmpty(db);

const app = express();
app.use(cors());
app.use(express.json({ limit: "256kb" }));
app.use(morgan("tiny"));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use(express.static("public"));

app.post("/auth/login", (req, res) => {
  const parsed = loginBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  upsertReviewer(db, parsed.data);
  const token = issueToken(parsed.data);
  return res.json({ token, reviewer: parsed.data });
});

app.get("/tickets/available", requireAuth, (req, res) => {
  const reviewer = (req as AuthedRequest).reviewer;
  const limit = z.coerce.number().int().min(1).max(50).optional().safeParse(req.query.limit);
  const tickets = listAvailableTickets(db, reviewer.locale, limit.success ? limit.data : 10);
  return res.json({ tickets });
});

app.get("/tickets/mine", requireAuth, (req, res) => {
  const reviewer = (req as AuthedRequest).reviewer;
  return res.json({ tickets: listMyTickets(db, reviewer) });
});

app.post("/tickets/:id/reserve", requireAuth, (req, res) => {
  const reviewer = (req as AuthedRequest).reviewer;
  const p = z.object({ id: z.string().min(1) }).safeParse(req.params);
  if (!p.success) return res.status(400).json({ error: "invalid_ticket_id" });

  const out = reserveTicket(db, reviewer, p.data.id);
  if (!out.ok) return res.status(out.status).json({ error: out.error });
  return res.json(out.reservation);
});

app.post("/tickets/:id/confirm", requireAuth, (req, res) => {
  const reviewer = (req as AuthedRequest).reviewer;
  const p = z.object({ id: z.string().min(1) }).safeParse(req.params);
  if (!p.success) return res.status(400).json({ error: "invalid_ticket_id" });

  const out = confirmTicket(db, reviewer, p.data.id);
  if (!out.ok) return res.status(out.status).json({ error: out.error });
  return res.json(out.ticket);
});

app.get("/metrics", (_req, res) => res.json(getMetrics(db)));

const sweepMs = Math.max(1, config.releaseSweepIntervalSeconds) * 1000;
setInterval(() => {
  try {
    releaseExpiredReservations(db);
  } catch {
    // best-effort sweep
  }
}, sweepMs).unref();

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`listening on http://0.0.0.0:${config.port}`);
});
