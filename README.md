# Content Review Queue

Backend service + minimal UI for a locale-based ticket review queue with time-bound reservations.

## Features

- Reviewer “login” with `reviewer_id` + `locale` (JWT token)
- Browse available tickets within the reviewer’s locale only
- Reserve a ticket for 20 minutes (configurable)
- Confirm a reserved ticket before it expires
- Auto-release of unconfirmed, expired reservations (background sweep + on-request safeguard)
- `GET /metrics` for basic queue health stats
- Minimal frontend served from the backend (`/`)

## Run (Docker)

```bash
cd content-review-queue
docker-compose up --build
```

Open:
- UI: `http://localhost:3000/`
- API health: `http://localhost:3000/health`

## Run (Local)

```bash
npm install
npm run dev
```

## Ticket ingestion strategy

This project seeds tickets into SQLite on startup (only if the `tickets` table is empty).

Why:
- Keeps the prototype self-contained (no external DB required).
- Deterministic enough for demos/tests while still resembling “ingestion”.

Potential improvements:
- Separate ingestion service / queue.
- Persist tickets from files per locale.
- Use Postgres + advisory locks / SKIP LOCKED for higher concurrency.

## API

### Authenticate

```bash
curl -sS -X POST http://localhost:3000/auth/login \\
  -H 'content-type: application/json' \\
  -d '{ "reviewer_id": "r1", "locale": "west-coast" }'
```

Save the returned `token` and use it as `Authorization: Bearer ...`.

### List available tickets (locale-scoped)

```bash
curl -sS http://localhost:3000/tickets/available \\
  -H "authorization: Bearer $TOKEN"
```

### Reserve a ticket

```bash
curl -sS -X POST http://localhost:3000/tickets/TICKET_ID/reserve \\
  -H "authorization: Bearer $TOKEN"
```

### Confirm a ticket

```bash
curl -sS -X POST http://localhost:3000/tickets/TICKET_ID/confirm \\
  -H "authorization: Bearer $TOKEN"
```

### My tickets (reserved / in-progress)

```bash
curl -sS http://localhost:3000/tickets/mine \\
  -H "authorization: Bearer $TOKEN"
```

### Metrics (bonus)

```bash
curl -sS http://localhost:3000/metrics
```

## Key design decisions

- **SQLite + explicit tables** (`reviewers`, `tickets`, `reservations`) to keep the system self-contained but still normalized.
- **Single active reservation per ticket** via `tickets.current_reservation_id`.
- **Time-bound logic** implemented in `releaseExpiredReservations()` and run:
  - periodically in a background sweep
  - opportunistically before reading/reserving to avoid “stuck” tickets

## LLM usage

Used Codex (LLM) to scaffold the project and implement the API/DB logic from the assignment spec.

## Roadmap

- “Complete” / “finish ticket” endpoint and lifecycle.
- Pagination, sorting and reviewer work queues.
- WebSocket/SSE push of new tickets per locale.

## Configuration

Environment variables (Docker sets these in `docker-compose.yml`):

- `DB_PATH` (default `./data/app.db`)
- `RESERVATION_TTL_SECONDS` (default `1200` = 20 minutes)
- `RELEASE_SWEEP_INTERVAL_SECONDS` (default `30`)
- `SEED_ON_STARTUP` (default `true`)
- `JWT_SECRET` (default `dev-secret-change-me`)
