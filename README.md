# Queue Cure '26 — Live Clinic Queue Manager

> Built for the **Queue Cure '26** hackathon on Wooble.
> Stack: **Node.js · Express · MongoDB · Socket.IO · Vanilla JS · QRCode**

### 🟢 Live demo → **https://queue-1-eg77.onrender.com**

Open these on any device to see it running:

- **Receptionist** — https://queue-1-eg77.onrender.com/receptionist
- **Waiting-room display** — https://queue-1-eg77.onrender.com/display
- **Patient phone** — https://queue-1-eg77.onrender.com/patient

> ⚠️ Hosted on Render's free tier — first request after 15 min of inactivity takes ~30 seconds to wake up. After that, response times are normal. **Warm it up by clicking the link once before any demo.**

---

A neighbourhood clinic runs on paper tokens and shouting. A patient walks in, gets a paper slip, then sits for two hours with zero information. This project replaces all of that with three screens that stay in lockstep over a live socket — **and zero paper**, because the QR is shown on the receptionist's existing monitor instead of printed.

| Stat | What it means |
|---|---|
| **~5 sec** | Time to issue a token (name + Enter, phone optional) |
| **< 300 ms** | Cross-screen sync latency on local network |
| **0** | Paper slips printed per patient — the QR is shown on the receptionist screen |
| **n = 10** | Rolling window of real consultations driving the ETA |

---

## The one-sentence demo moment

> Receptionist types **"Asha Patel"** + Enter. A 132 px QR pops up on her screen. Asha holds up her phone, scans, walks away. Five seconds later the receptionist hits Spacebar — Asha's phone chimes and says **"It's your turn"** while the wall-mounted TV slides token `#7 → #8` with an overshoot bounce. From walk-in to live tracking in eight seconds, no paper, no app install, no typing.

---

## Four screens, one source of truth

| URL | Who uses it | What it does |
|---|---|---|
| `/` | Anyone | Landing — links to all three roles |
| `/receptionist` | Front desk | Add patient (Enter), call next (Space), undo (U), skip / remove, **per-patient QR slip** |
| `/display` | Waiting-room TV | Giant glowing token, "patients ahead", `+8m / +16m` chips, **wall-mount QR** |
| `/patient` | Patient phone | Live position + ETA, banner state changes on serving / next-up / your-turn, chime on call |

Open any two next to each other — every change made on one appears on all the others within a single network round-trip.

---

## Quick start

```powershell
# 1. Clone & install
git clone <your-repo-url> queue-cure
cd queue-cure
npm install

# 2. Configure MongoDB
copy .env.example .env
#   • For local Mongo, leave the default URI.
#   • For Atlas, replace MONGO_URI with your connection string.

# 3. Seed a realistic clinic snapshot (highly recommended)
npm run seed
#   Inserts 9 patients across statuses so every screen looks
#   populated the moment you load it, and the rolling-average
#   ETA fires immediately.

# 4. Start the server
npm start
```

Then open:

- http://localhost:3000 — landing
- http://localhost:3000/receptionist
- http://localhost:3000/display
- http://localhost:3000/patient

**Recommended demo setup:** `/receptionist` on the left half of your screen, `/display` on the right half, `/patient` on your phone (use your LAN IP, e.g. `http://192.168.1.5:3000/patient` — or scan the QR on `/display`).

---

## How this answers each judging criterion

### 1. Live queue updates across both screens without refresh — 40%

- Every mutation is a REST call that writes to MongoDB, then broadcasts a fresh full snapshot over Socket.IO.
- Clients are dumb re-renderers: they receive `queue:updated` → call `render(snapshot)`. **No client-side state machine, no delta merging, no chance of drift.**
- The connection pill in the top-right of every screen turns green when the socket is live; on disconnect it shows "Reconnecting…" and auto-resyncs via `queue:resync`.
- See [`docs/SOCKET_EVENTS.md`](docs/SOCKET_EVENTS.md) for the event diagram and full snapshot shape.

### 2. Wait time computed from real data, not hardcoded — 25%

- Every time a patient moves from `serving → done`, we record the actual elapsed seconds (`completedAt − calledAt`).
- The shown ETA is a **rolling average of the last 10 real consultations** today.
- A receptionist-configurable default is used **only as a cold-start fallback**, and the UI is honest about it — the display footer shows `Wait time source: rolling average of last N consultations` vs `clinic default (calibrating)`.
- A patient's individual ETA = (remaining time on the current serving patient) + (position × rolling avg).

### 3. Fast and mistake-proof receptionist screen — 20%

- One screen, no modals, no page reloads, fits above the fold at 1080p.
- **Add patient in under 5 seconds:** only the name is required; auto-focus on the name field returns after every add.
- **Keyboard-first:** `Enter` → add · `Space` → call next · `Esc` → close QR slip
- **Undo button:** reverses the most recent call-next. Catches the inevitable double-click.
- **Skip / Remove:** mark a no-show (can be recalled) or hard-delete from the queue (only while waiting/skipped, never after they've been served).
- Buttons disabled when their action is invalid — the receptionist physically cannot do the wrong thing.
- **Per-patient QR slip:** after every Issue Token, a 340 px card pops in the bottom-right with a scannable QR for that patient. Auto-dismisses in 12 s; reusable from any row's `📱 QR` button.

### 4. Concurrency and edge cases — 15%

Full write-up in [`docs/THOUGHT_PROCESS.md`](docs/THOUGHT_PROCESS.md). Highlights:

- **Atomic token assignment** via `Counter.findOneAndUpdate({$inc: {seq:1}}, {upsert: true})` — two receptionists adding patients at the same millisecond can never collide.
- **State-guarded transitions** — every status change matches on the expected current status, so a double-clicked _Call Next_ is a clean no-op on the second click.
- **Reconciliation on reconnect** — every client emits `queue:resync` on (re)connect and the server replies with a fresh snapshot.
- **Daily reset** — tokens and counters are scoped by `YYYY-MM-DD`, so each day starts fresh and old data stays queryable.
- **Skipped patients** can be recalled to the end of the queue — no data loss.
- **Clock drift** is avoided by computing all elapsed times server-side from MongoDB timestamps.

---

## REST API surface

| Method | Path | What |
|---|---|---|
| `GET`  | `/api/queue` | Full current snapshot |
| `POST` | `/api/patients` | `{ name, phone? }` — add a patient, returns token |
| `POST` | `/api/queue/call-next` | Close current, promote next waiting |
| `POST` | `/api/queue/undo` | Reverse the most recent call-next |
| `POST` | `/api/patients/:id/skip` | Mark a waiting patient as no-show |
| `POST` | `/api/patients/:id/recall` | Put a skipped patient at the back of the queue |
| `DELETE` | `/api/patients/:id` | Hard-delete a waiting or skipped patient |
| `PATCH`| `/api/clinic` | Update name / default consultation minutes |
| `GET`  | `/api/patients/token/:token` | Look up a patient by today's token |
| `GET`  | `/api/qr/patient[?token=N]` | SVG QR code → `/patient` or `/patient?token=N` |
| `POST` | `/api/queue/reset` | Wipe today's queue (end-of-day) |

Every mutation triggers a `queue:updated` socket broadcast.

---

## Project layout

```
queue-cure/
├── server.js                       # express + socket.io bootstrap
├── scripts/
│   └── seed.js                     # populates a realistic clinic snapshot
├── src/
│   ├── config/db.js                # mongoose connection
│   ├── models/
│   │   ├── Patient.js              # token, name, status, calledAt, completedAt
│   │   ├── Clinic.js               # singleton: name, default consult minutes
│   │   └── Counter.js              # atomic per-day token sequence
│   ├── services/
│   │   ├── queueService.js         # add / call-next / undo / skip / recall / remove
│   │   └── statsService.js         # rolling-average ETA + snapshot builder
│   ├── routes/api.js               # all REST + QR endpoints (broadcast on mutation)
│   └── sockets/index.js            # connect / resync / snapshot push
├── public/
│   ├── index.html                  # landing
│   ├── receptionist.html           # operator console (light theme)
│   ├── display.html                # waiting-room TV (light theme)
│   ├── patient.html                # mobile patient view (light theme)
│   ├── css/
│   │   ├── style.css               # shared light theme for landing/display/patient
│   │   └── receptionist.css        # dashboard-specific (grid bg, hero tile, QR slip)
│   └── js/{common,receptionist,display,patient}.js
└── docs/
    ├── SOCKET_EVENTS.md            # event flow diagram + snapshot shape
    └── THOUGHT_PROCESS.md          # concurrency, edge cases, UI/UX rationale
```

---

## Design notes

- **Light clinical theme** across every screen — pure white background with a faint blue Blueprint Grid, slate-800 text, medical-blue `#2563EB` accent. Chosen to minimise glare for a receptionist working under fluorescent lighting all day.
- **One intentional animation per moment:** entrance boxIn + hover lift on cards, overshoot pop on `NOW SERVING` pill, slide-up + fade on token swap, slow ambient pulse on the display "now serving" panel, urgent pulse on patient "your turn" state.
- **Two-tone medical chime** (D5 → A5) synthesised via Web Audio API — no audio file, no autoplay quirks after first user interaction.
- **Zero-paper QR:** the receptionist's monitor is the QR display. The patient scans from the desk and walks away with live tracking on their phone. No printer, no thermal paper, no ink cost.

---

## Submission checklist (Wooble portfolio)

- ✅ **Working prototype link** — https://queue-1-eg77.onrender.com (live on Render free tier)
- ✅ **GitHub repo with README** — this file
- ✅ **Socket event diagram** — [`docs/SOCKET_EVENTS.md`](docs/SOCKET_EVENTS.md)
- ✅ **Thought-process sheet** — [`docs/THOUGHT_PROCESS.md`](docs/THOUGHT_PROCESS.md)
