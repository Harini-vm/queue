# Queue Cure '26

### Live clinic queue manager — paper tokens, retired.

**Hackathon:** Queue Cure '26 · Wooble · Full Stack
**Built by:** Harini V M
**Live demo:** https://queue-1-eg77.onrender.com
**GitHub:** https://github.com/harinivm77/queue-cure

---

| ~5 sec | < 300 ms | 0 | n = 10 |
|:---:|:---:|:---:|:---:|
| Patient registered (Name + Enter) | Cross-screen sync latency | Paper slips printed per patient | Rolling consultation window |

---

## 1. The problem

76% of India's 1.5 million clinics still run on paper token slips. Patients wait two to three hours with zero visibility into the queue. Receptionists track every patient from memory. Doctors have no dashboard.

The cost compounds across three groups:

| Stakeholder | Daily pain |
|---|---|
| **Patient** | Sits two hours not knowing if they're next or twenty out. Cannot step out, cannot estimate. |
| **Receptionist** | Holds the entire queue in working memory. Repeats numbers to anxious patients. Gets blamed for skipped slots. |
| **Clinic owner** | Recurring cost of paper, printer cartridges, thrown-away slips. No analytics on flow or no-show rate. |

Every clinic already owns the hardware needed to fix this — a smartphone (in the receptionist's pocket), a laptop (at the front desk), and often a wall TV. The missing piece is software that turns those three devices into one synchronised system.

## 2. The solution

Queue Cure is three screens that share one source of truth.

| Surface | Who uses it | What it shows |
|---|---|---|
| `/receptionist` | Front desk operator | Add patient, call next, manage cadence, per-row 📱 QR action |
| `/display` | Waiting-room TV | Giant glowing token, "patients ahead" counter, up-next chips, wall-mount QR |
| `/patient` | Patient's own phone | Live position, ETA, banner that changes state — `Waiting → Next Up → Your Turn → Done` |

Open any two next to each other. Click `Call Next` on one. Every other client repaints the new state within a single network round-trip. No refresh, no polling, no drift.

### The "wow" moment that sells it

> Receptionist types **"Asha Patel"** + Enter. A 132px QR pops up on her screen. Asha holds her phone, scans, walks away. Five seconds later the receptionist hits Spacebar — Asha's phone chimes and says **"It's your turn"** while the wall TV slides token `#7 → #8` with an overshoot bounce. From walk-in to live tracking in eight seconds. No paper, no app install, no typing.

## 3. Architecture

```
                  ┌───────────────────────┐
                  │   MongoDB Atlas       │
                  │   (Patient, Clinic,   │
                  │    Counter)           │
                  └──────────┬────────────┘
                             │ Mongoose
                             ▼
              ┌──────────────────────────────┐
              │   Node.js + Express          │
              │  ─────────────────────────   │
              │   REST routes  (writes)      │
              │   Socket.IO    (broadcasts)  │
              │   QR generator (per-token)   │
              └──┬─────────────┬─────────────┘
                 │ REST        │ WebSocket
                 │ POST/PATCH  │ queue:updated
                 │ /DELETE     │ queue:snapshot
       ┌─────────┼─────────────┼─────────────┐
       ▼         ▼             ▼             ▼
 Receptionist   Wall TV     Patient        (N future
   console     (display)   phone view      clients)
```

**Stack:** Node.js · Express · MongoDB · Socket.IO · QRCode · Vanilla HTML/CSS/JS

**Why no framework?** Zero build step. `npm install && npm start` — judges can clone and run in 30 seconds. The frontend is three HTML files and three short JS files. Total client payload under 25 KB.

### The single architectural decision that defined everything

I considered putting `addPatient` and `callNext` as socket events. I rejected it within an hour because:

- Sockets give you no standard error codes — every event needs a custom ack convention.
- Sockets aren't testable from `curl`.
- Standard webserver middleware (rate limiting, centralised error handling, access logs) assumes HTTP.

The final design splits the duties cleanly:

- **REST does the writes.** Standard HTTP status codes, standard middleware, curl-testable.
- **Sockets do the reads.** One event, `queue:updated`, broadcasting a fresh full snapshot after every mutation.

Clients are dumb re-renderers. They receive a snapshot → call `render(snapshot)`. **No client-side state machine, no delta merging, no chance of drift.** This is the same pattern Stripe, Linear, and most production realtime apps use.

## 4. How this maps to the judging criteria

### Criterion 1 — Live updates across both screens, no refresh (40%)

Every mutation follows the same five-step path:

```
[client clicks] → POST /api/queue/call-next
              → Express handler
              → Mongoose mutation (status-guarded)
              → buildSnapshot()
              → io.emit('queue:updated', snapshot)
                     ▼
              every connected client renders the new snapshot
```

The connection pill in the top-right of every screen turns green when the socket is live; on disconnect it auto-resyncs via `queue:resync`. Whole-snapshot broadcast was chosen over deltas — a busy clinic snapshot is under 5 KB, and full snapshots eliminate the entire class of "client got out of sync" bugs.

### Criterion 2 — Wait time from real data, not hardcoded (25%)

Every time a patient transitions `serving → done`, the server records the actual elapsed seconds: `completedAt − calledAt`. The shown ETA is then a **rolling average of the last ten of these real consultations**.

A receptionist-configurable default exists, but **only as a cold-start fallback**, and the UI is honest about which mode it's in:

| State | UI label |
|---|---|
| 0 consultations served | `Fallback · calibrating` (amber) |
| ≥1 consultation served | `Real avg 7.0 min · n=3` (green) |

A patient's individual ETA also subtracts the time already elapsed on the patient currently in the chair, so the front-of-queue number doesn't lie.

```js
patient.eta = (avg × position_in_queue) + servingRemainingSeconds
```

### Criterion 3 — Fast and mistake-proof receptionist screen (20%)

Eleven specific design decisions, every one earning its place:

1. **One screen.** No modals, no page reloads, fits above the fold at 1080p.
2. **Auto-focus on the Name input** on page load and after every successful add.
3. **Name is the only required field.** Phone is explicitly optional and labelled as such.
4. **Keyboard-first.** `Enter` adds a patient · `Space` calls next · `Esc` closes the QR slip.
5. **Undo button.** Reverses the most recent call-next. Catches the inevitable double-click.
6. **Skip / Remove split.** Skip preserves a no-show for later recall; Remove deletes outright and is guarded so you cannot remove a patient mid-consultation.
7. **Disabled buttons when invalid.** The receptionist physically cannot do the wrong thing.
8. **Stat chips in the queue header** so the count is visible at a glance: `4 waiting · 3 seen · 1 skipped`.
9. **Live "in chair for X minutes" timer** on the currently-served patient, ticking once a second client-side without re-fetching.
10. **Form-input flash on add** — the inputs briefly glow blue, then clear, then refocus. Prevents the operator from wondering "did it submit?" and double-firing.
11. **Per-patient QR slip** — the killer feature. After every Issue Token, a 340px card pops in the bottom-right with a scannable QR for that patient. Auto-dismisses in 12 seconds. Reusable from any row's 📱 QR button. The patient scans the receptionist's monitor and walks away — **no printer, no paper, no typing.**

### Criterion 4 — Concurrency and edge cases (15%)

This is the criterion most submissions handwave. Mine has a code path for each.

**Race condition: two receptionists assign tokens at the same millisecond.**
Naive `count() + 1` has a textbook race. Replaced with:
```js
Counter.findOneAndUpdate(
  { _id: `token-${today}` },
  { $inc: { seq: 1 } },
  { upsert: true, new: true }
);
```
`findOneAndUpdate` is atomic at the MongoDB level. Two concurrent inserts always get distinct sequence numbers. **This is the single most important line of code in the project.**

**Race condition: receptionist double-clicks Call Next.**
Every state transition uses a status-guarded update:
```js
const next = await Patient.findOneAndUpdate(
  { day, status: 'waiting' },
  { status: 'serving', calledAt: now },
  { sort: { token: 1 }, new: true }
);
```
The `status: 'waiting'` filter is part of the atomic match. Once the first click writes `'serving'`, the second click's filter no longer matches — it returns `null` and is a clean no-op.

**Receptionist hits Call Next on the wrong patient.**
The Undo button reverses the most recent transition: it demotes the current `serving` back to `waiting` (front of queue) and re-promotes the most recent `done` patient back to `serving`. Available within seconds.

**Patient doesn't show up when called.**
The Skip action marks them `skipped`. They can later be `recalled` — their record stays for analytics, but they're moved to the back of the queue with a fresh token number.

**Receptionist's browser crashes mid-day.**
On refresh, the snapshot comes from MongoDB. Nothing is held in browser memory. Live timer state is reconstructed from `calledAt`.

**Patient's phone goes to sleep.**
Socket auto-reconnects. Client emits `queue:resync`. Server replies with a fresh snapshot. The token they entered is held in `localStorage`, so the UI is back where they left it.

**Clinic has never served a patient today.**
No data → can't compute a rolling average. Falls back to the receptionist-configured default, and the UI label switches from green `Real avg` to amber `Calibrating`. As soon as one patient is served, the source flips.

**End of day, tokens stay at 47, but tomorrow should start at 1.**
Both `Patient` and `Counter` documents are scoped by `day = 'YYYY-MM-DD'`. The first patient on the new day creates a new counter starting at 1. No midnight cron job, no manual reset script.

**Clock skew between the receptionist's laptop and the display TV.**
All elapsed times are computed server-side from MongoDB `calledAt` / `completedAt` timestamps. Clients never compute "X minutes ago" from their own clock.

## 5. UI / UX rationale

**Light clinical theme — pure white, medical blue `#2563EB`, slate-800 text.** A dark dashboard demos beautifully on a designer's monitor and fatigues real users by hour three. The receptionist works under fluorescent clinic lighting. Light wins.

Behind the floating cards sits a faint **Blueprint Grid** — two 1px linear-gradients at 32px spacing in 5%-opacity blue — that frames the UI like an engineering drawing. Pure CSS, no images, no perf cost.

**Animations are not decorative.** Every keyframe corresponds to a specific UX moment a judge will look for:

| Animation | UX purpose | Criterion |
|---|---|---|
| Call Next overshoot pop on the `NOW SERVING` pill, plus a soft Web Audio chime (D5 → A5, the medical two-tone) | Visual + auditory confirmation that the realtime sync is active across all open screens | #1 (40%) |
| Add Patient flash — both inputs glow blue for 360ms, clear, refocus; new row slides up at the bottom of the queue table | Unambiguous "your action committed" feedback. Prevents double-add | #3 (20%) |
| Top-of-queue flash — the new front row fades from blue to neutral | Tells the receptionist "this is who's up next now" without re-reading the token number | #3 (20%) |
| Display "Now Serving" panel — slow 3.6s ambient pulse | Pulls a glance from across a waiting room without being distracting | #1 (40%) |
| Patient "Your turn" — urgent 1.6s pulse with growing outer ring | Demands attention until the patient looks up and walks in | UX |

I deliberately did **not** add hover scaling on the receptionist console, parallax, or animated gradients. Every motion costs a millisecond of operator attention.

**The chime uses the Web Audio API** to synthesise a D5 → A5 sine pair (a perfect fifth — the classic two-tone medical alert) with a 400ms decay. No audio file, no autoplay issues, tuned quiet enough (gain 0.18) not to startle a waiting room.

## 6. Results

| Metric | Result | How it was measured |
|---|---|---|
| Patient registration | **~5 seconds** | Name + Enter, phone optional, refocus immediate |
| Cross-screen sync latency | **< 300 ms** | Local network round-trip; click-to-paint on second screen |
| Paper slips printed | **0** | Per-patient QR shown on existing receptionist monitor |
| ETA data source | **Rolling average of last 10 consultations** | Not hardcoded; falls back only on day-one |
| Concurrent token assignment | **No collisions** | Atomic MongoDB `$inc` + upsert |
| Double-clicked Call Next | **Clean no-op** | Status-guarded transition; second click matches nothing |

## 7. What I'd do differently

Three things, honestly.

**First, ship automated tests earlier.** My concurrency claims are documented in detail but only spot-checked. A test that fires 50 parallel `addPatient()` calls and asserts 50 distinct tokens would prove the atomic counter in seconds, instead of asking judges to trust the doc.

**Second, add per-doctor lanes.** This MVP assumes one queue per clinic. Larger clinics run two or three doctors in parallel, each with their own queue. The data model would need a `doctorId` on `Patient` and per-doctor `Counter` documents — a real but bounded refactor.

**Third, build telemetry.** Daily average wait, busiest hours by day-of-week, no-show rate, average consultation time per doctor. A weekly insight email would turn this from "queue manager" into "ops dashboard." That's where a clinic owner would start paying for it.

The hardest cut was **authentication**. Currently any URL is open — anyone with the IP can be the receptionist. For a single-clinic deployment a 4-digit PIN would have been enough, but I chose to keep scope tight rather than half-ship a security layer. It's documented as a known limitation, not a forgotten one.

## 8. Submission deliverables

| Required | Location |
|---|---|
| Working prototype | https://queue-1-eg77.onrender.com |
| GitHub repo with README | https://github.com/harinivm77/queue-cure |
| Socket event diagram | `docs/SOCKET_EVENTS.md` |
| Thought-process sheet | `docs/THOUGHT_PROCESS.md` |
| Case study (this document) | `docs/CASE_STUDY.md` |
| Demo video | linked in submission |

---

*Built in seven days for Queue Cure '26 on Wooble.*
