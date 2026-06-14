# Socket Event Diagram

> Queue Cure '26 — required deliverable

The system uses **one socket event in each direction**, intentionally. All writes are REST so they're auditable; the socket only fans out the post-write snapshot. This keeps the socket layer impossible to desync from the database.

---

## End-to-end flow: "Call Next" click

```
┌──────────────────┐        ┌───────────┐       ┌─────────┐       ┌──────────────────┐
│  Receptionist    │        │  Express  │       │ MongoDB │       │  Display / Phone │
│   browser        │        │   /api    │       │         │       │   browsers       │
└────────┬─────────┘        └─────┬─────┘       └────┬────┘       └────────┬─────────┘
         │                        │                  │                     │
         │  Space pressed         │                  │                     │
         │  POST /api/queue/      │                  │                     │
         │       call-next        │                  │                     │
         ├───────────────────────▶│                  │                     │
         │                        │                  │                     │
         │                        │  findOneAndUpdate│                     │
         │                        │  serving → done  │                     │
         │                        ├─────────────────▶│                     │
         │                        │                  │                     │
         │                        │  findOneAndUpdate│                     │
         │                        │  waiting → serving                     │
         │                        ├─────────────────▶│                     │
         │                        │                  │                     │
         │                        │  buildSnapshot() │                     │
         │                        ├─────────────────▶│                     │
         │                        │◀─────────────────┤                     │
         │                        │                  │                     │
         │                        │   io.emit('queue:updated', snapshot)   │
         │                        ├───────────────────────────────────────▶│
         │                        │                                        │
         │   200 OK               │                                        │
         │◀───────────────────────┤                                        │
         │                        │                                        │
         │   queue:updated ◀──────┴────────────────────────────────────────┤
         │   render(snapshot)                                              │
         │                                                                 │
```

All connected clients — including the one that triggered the change — re-render from the same snapshot. **There is no client-side state machine.** The server is the only source of truth.

---

## Events table

### Client → Server

| Event | Payload | When | Purpose |
|---|---|---|---|
| `queue:resync` | `()` | On every (re)connect | Ask for a fresh snapshot in case the auto-push was missed during handshake |

That's the only client-to-server event. **No mutations go over sockets** — they all use REST so they get HTTP status codes, auth, idempotency keys, and centralised error handling.

### Server → Client

| Event | Payload | When | Receivers |
|---|---|---|---|
| `queue:snapshot` | Full snapshot | On `connection` and on `queue:resync` | The one socket that just connected |
| `queue:updated`  | Full snapshot | After every successful REST mutation | All connected sockets (broadcast) |

Both events carry the **identical payload shape**, so clients have one render function:

```js
socket.on('queue:snapshot', render);
socket.on('queue:updated', render);
```

---

## Snapshot payload

```jsonc
{
  "day": "2026-06-14",
  "clinic": {
    "_id": "main",
    "name": "Sunrise Family Clinic",
    "defaultConsultationMinutes": 8
  },
  "serving": {
    "_id": "...",
    "token": 7,
    "name": "Asha P.",
    "status": "serving",
    "calledAt": "2026-06-14T10:42:18.221Z"
  },
  "servingRemainingSeconds": 240,
  "waiting": [
    { "token": 8, "name": "Ravi K.", "position": 1, "etaSeconds": 240 },
    { "token": 9, "name": "Meera S.", "position": 2, "etaSeconds": 720 }
  ],
  "recentDone": [ /* last 5 done patients */ ],
  "avg": {
    "seconds": 480,
    "source": "rolling-average",   // or "receptionist-default"
    "sampleSize": 10
  },
  "counts": { "waiting": 2, "done": 6, "skipped": 1 },
  "serverTime": 1734177738221
}
```

Why send the whole thing on every change?

- **Tiny** — a busy clinic has <100 patients/day; the snapshot is a few KB.
- **Always consistent** — clients can't drift because they don't accumulate state.
- **Simple to reason about** — one event, one render path.
- **Reconnect is free** — when a phone reconnects after a lift-pocket trip, the next snapshot fixes everything.

---

## Why REST writes + socket reads (and not full Socket.IO RPC)?

| | REST writes + socket reads | Mutations over sockets |
|---|---|---|
| HTTP status codes for the operator | ✅ | ❌ (custom ack convention) |
| Easy to test from `curl` / Postman | ✅ | ❌ |
| Centralised error middleware | ✅ | ❌ |
| Auditable in standard access logs | ✅ | ❌ |
| Latency on receivers | Same (post-write broadcast) | Same |
| Idempotency keys / retries | Standard | Custom |

This split is the same pattern Stripe, Linear, and most production realtime apps use. It costs one extra HTTP request from the trigger client and buys back every standard webserver tool.
