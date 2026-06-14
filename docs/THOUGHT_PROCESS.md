# Thought Process — Queue Cure '26

> Required deliverable. Addresses judging criterion #4 (concurrency + edge cases, 15%) explicitly, and shows the reasoning behind the other three.

---

## The real-world model the code is shaped around

A neighbourhood clinic has:

- **One receptionist console** (sometimes two, when it's busy)
- **One waiting-room display** (the TV on the wall)
- **N patient phones** (everyone in the waiting room, plus a few people who haven't shown up yet)

The numbers that matter:

- Patients per day: 30–80
- Concurrent connected clients: 2–60
- Tokens issued per minute peak: ~3
- Time the receptionist will tolerate to add one patient: < 10 seconds

This is a **read-heavy, low-write** system. Optimising for write throughput is the wrong axis. Optimising for **never being wrong** is the right one — if the display shows the wrong token even once, the clinic owner stops trusting the product.

---

## Architectural decisions and the alternatives I rejected

### 1. Why REST writes + Socket.IO broadcasts (not full socket RPC)

I considered putting `addPatient` and `callNext` as socket events. I rejected it because:

- Sockets give you no standard error codes — you have to invent an ack convention per event.
- They're hard to test from `curl` during development.
- Standard webserver tooling (access logs, rate limiting middleware, idempotency keys) all assumes HTTP.

So: REST does the writes, the socket layer fans out the result. One mutation = one broadcast. Same pattern as most production realtime apps.

### 2. Why send the **whole snapshot** on every change (not deltas)

A delta system would be:

```
{ type: 'patient.added', payload: { token: 9, name: 'Meera' } }
{ type: 'patient.called', payload: { token: 7 } }
```

It's smaller per message. It's also a footgun: if a client drops one event, its state silently diverges from the server's. You then need sequence numbers, gap detection, resync flows, and tests for partial-resync.

The whole snapshot for a clinic is a few KB. **Bandwidth was never the constraint here, correctness was.** Whole-snapshot means clients are stateless re-renderers and reconnection is free.

### 3. Why one Mongo `Counter` doc per day, not per-clinic auto-increment

MongoDB doesn't have SQL-style auto-increment. The naïve approach — `count() + 1` — has a classic race condition: two simultaneous adds both read the same count and both write the same token.

The fix is one atomic write:

```js
Counter.findOneAndUpdate(
  { _id: `token-${today}` },
  { $inc: { seq: 1 } },
  { upsert: true, new: true }
);
```

`findOneAndUpdate` is atomic at the database level. Even if the Node process runs both calls in parallel, MongoDB serialises them and each call gets a unique sequence number. **This is the single most important line of code in the project for concurrency.**

Scoping the counter by day also gives us free daily rollover — June 14's tokens count `1, 2, 3…` independently of June 15's.

### 4. Why every state transition uses a **status-guarded** update

The naïve "call next" is:

```js
const next = await Patient.findOne({ status: 'waiting' }).sort({ token: 1 });
await Patient.updateOne({ _id: next._id }, { status: 'serving' });
```

This has a race window between the read and the write. If two receptionists click _Call Next_ within milliseconds, they could both pick the same waiting patient.

The guarded version:

```js
const next = await Patient.findOneAndUpdate(
  { day, status: 'waiting' },              // ← status check is part of the atomic match
  { status: 'serving', calledAt: now },
  { sort: { token: 1 }, new: true }
);
```

The status `'waiting'` is part of the document-match filter. Once the first call writes `'serving'`, the second call's filter no longer matches — it returns `null` and is a clean no-op. Same trick for closing out the previous serving patient.

---

## Edge cases and how each is handled

### A. The receptionist double-clicks "Call Next"

- First click flips patient 7 from serving → done, and patient 8 from waiting → serving.
- Second click flips patient 8 from serving → done (with a tiny consultation time), and patient 9 from waiting → serving.
- That's a real mistake.

**Mitigation 1**: button is disabled in JS for the few hundred ms between click and snapshot return.
**Mitigation 2** (the real one): the **Undo button**. One click reverses the most recent call-next — promotes the just-closed patient back to serving, demotes the current serving back to the front of the waiting queue. Mistake-proof.

### B. A patient is called but doesn't show up

The receptionist hits **Skip**. The patient moves to status `'skipped'`. They can be **recalled** later — when they come back from the bathroom, one click puts them at the *back* of the queue with a fresh, larger token. We never delete them, so the day's stats stay accurate.

### C. Two receptionists work the same console (multi-device)

Both browsers are subscribed to the same socket events. The instant one of them adds a patient, the other's queue updates. Status-guarded mutations prevent them from stepping on each other.

### D. The receptionist's browser crashes mid-day

On refresh, the snapshot comes from MongoDB — nothing is held in browser memory. The current serving patient, the in-progress consultation timer, the entire queue: all reconstructed from the DB.

### E. The patient closes their phone screen, walks around, comes back

Socket auto-reconnects. The client emits `queue:resync`. Server replies with a fresh snapshot. The token they entered is held in `localStorage`, so the UI is back exactly where they left it.

### F. The clinic has never served a patient today

No data → can't compute a rolling average. Falls back to the receptionist-configured default, **and the UI says so**: `Wait time source: clinic default (calibrating)`. As soon as one patient is served, the source flips to `rolling-average (n=1)` and the number gets more accurate with every consultation.

### G. The receptionist sets the default to a silly value (3000 minutes)

Server-side clamping: `Math.min(60, Math.max(1, value))`. The client form also has `min=1 max=60`. Defence in depth.

### H. Clock drift between the receptionist's laptop and the display TV

All elapsed times are computed from MongoDB-stamped `calledAt`/`completedAt` on the server. Clients never compute "X minutes ago" from their local clock. The only client-side clock use is the wall-clock display in the corner, which is cosmetic.

### I. End of day — tokens stay at 47, but tomorrow should start at 1

Both the `Patient` collection and the `Counter` collection are scoped by `day = 'YYYY-MM-DD'`. The first patient on the new day creates a new counter doc starting at 1. No code change, no reset script needed at midnight. The manual **Reset today's queue** button exists only for testing and end-of-day clean-up.

### J. Network drops between Express and MongoDB

Mongoose buffers operations for a short window and retries; if the connection stays down, the API returns 500s. The frontend shows a toast and the queue stays at the last good snapshot — no fake success, no silent data loss.

---

## UI / UX decisions

I intentionally used a **high-contrast LIGHT theme** (white surface, medical-blue accent `#2563eb`, slate-800 text) to minimise screen glare and eye strain for a receptionist working under fluorescent clinic lighting all day. A dark dashboard demos beautifully on a designer's monitor and fatigues real users by hour three.

Behind the floating cards sits a faint **Blueprint Grid** — two 1px linear-gradients at 32px spacing in 5%-opacity blue — that frames the UI like an engineering drawing without competing with content. Pure CSS, no images, no perf cost.

Animations are not decorative; **every keyframe corresponds to a specific UX moment a judge is looking for**:

| Animation | UX purpose | Criterion it answers |
|---|---|---|
| **Call Next overshoot** — the `NOW SERVING · #N` pill pops with a `cubic-bezier(0.34, 1.56, 0.64, 1)` overshoot the instant the serving token changes; the giant token on the waiting-room display slides up + fades out, then a new number slides in from below with the same overshoot, accompanied by a soft Web Audio chime | Immediate visual + auditory confirmation that the realtime queue sync is active across all open screens | #1 (40%) |
| **Add Patient flash** — both form inputs glow blue for 360ms, the inputs clear, focus stays on Name, and the new row slides up into the bottom of the table with a fading blue wash | The receptionist gets unambiguous feedback that the action committed, so they don't double-click `Add` and create a phantom token | #3 (20%) |
| **Top-of-queue flash** — when the front of the waiting list changes, that row briefly fades from soft blue to neutral | Tells the receptionist "this is who's up next now" without them having to re-read the token number | #3 (20%) |

I deliberately did **not** add hover scaling, parallax, or animated gradients. Every motion costs a millisecond of the receptionist's attention; the ones above each pay for that cost.

The chime uses the Web Audio API to synthesise an A5 → E6 sine pair with a 400ms decay — no audio file, no autoplay issues after the first user interaction, and tuned quiet enough (gain 0.18) not to startle a waiting room.

## What I'd add next (not in MVP, but planned)

- **WhatsApp / SMS** that nudges the patient when they're 2 tokens away.
- **Per-doctor lanes** — bigger clinics have 2–3 doctors running parallel queues.
- **Historical analytics** — average consult time per weekday, busiest hours.
- **Auth** — currently any URL is open; a tiny PIN on `/receptionist` is enough for a single-clinic deployment.

I deliberately did **not** ship any of these in the MVP. The brief asked three questions; the project answers all three, and adding more would have made the demo less crisp without making the core stronger.
