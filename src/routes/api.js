const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const Q = require('../services/queueService');

/**
 * Wrap an async handler so thrown errors land in the centralised
 * error middleware below — no try/catch boilerplate per route.
 */
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/**
 * After every successful mutation, push the fresh snapshot to all
 * connected clients. This is the heartbeat of "live updates without
 * refresh" — REST does the write, sockets do the fan-out.
 */
async function broadcast(req) {
  const io = req.app.get('io');
  const snapshot = await Q.buildSnapshot();
  io.emit('queue:updated', snapshot);
}

router.get(
  '/queue',
  wrap(async (_req, res) => {
    const snapshot = await Q.buildSnapshot();
    res.json(snapshot);
  })
);

router.post(
  '/patients',
  wrap(async (req, res) => {
    const patient = await Q.addPatient(req.body);
    await broadcast(req);
    res.status(201).json(patient);
  })
);

router.post(
  '/queue/call-next',
  wrap(async (req, res) => {
    const result = await Q.callNext();
    await broadcast(req);
    res.json(result);
  })
);

router.post(
  '/queue/undo',
  wrap(async (req, res) => {
    const restored = await Q.undoLastCall();
    await broadcast(req);
    res.json(restored);
  })
);

router.post(
  '/patients/:id/skip',
  wrap(async (req, res) => {
    const p = await Q.skipPatient(req.params.id);
    await broadcast(req);
    res.json(p);
  })
);

router.post(
  '/patients/:id/recall',
  wrap(async (req, res) => {
    const p = await Q.recallPatient(req.params.id);
    await broadcast(req);
    res.json(p);
  })
);

router.patch(
  '/clinic',
  wrap(async (req, res) => {
    const c = await Q.updateClinic(req.body);
    await broadcast(req);
    res.json(c);
  })
);

router.get(
  '/patients/token/:token',
  wrap(async (req, res) => {
    const p = await Q.findByToken(req.params.token);
    if (!p) return res.status(404).json({ error: 'Token not found today' });
    res.json(p);
  })
);

router.delete(
  '/patients/:id',
  wrap(async (req, res) => {
    const p = await Q.removePatient(req.params.id);
    await broadcast(req);
    res.json(p);
  })
);

router.post(
  '/queue/reset',
  wrap(async (req, res) => {
    await Q.resetDay();
    await broadcast(req);
    res.json({ ok: true });
  })
);

/**
 * Generate a QR-code SVG that points at /patient on this same host.
 * Two modes:
 *   • no query    → encodes /patient (the wall-display QR, generic)
 *   • ?token=N    → encodes /patient?token=N (the per-patient QR shown
 *                   on the receptionist screen after issuing a token —
 *                   patient scans, page auto-fills, no typing)
 *
 * GET /api/qr/patient[?token=N] → image/svg+xml
 */
router.get(
  '/qr/patient',
  wrap(async (req, res) => {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const token = parseInt(req.query.token, 10);
    const target =
      Number.isFinite(token) && token > 0
        ? `${proto}://${host}/patient?token=${token}`
        : `${proto}://${host}/patient`;
    const svg = await QRCode.toString(target, {
      type: 'svg',
      margin: 1,
      width: 240,
      color: { dark: '#1e293b', light: '#ffffff00' }, // transparent bg
      errorCorrectionLevel: 'M',
    });
    res.set('Content-Type', 'image/svg+xml');
    // Per-token QRs are stable; the generic one is too.
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(svg);
  })
);

// Centralised error handler — converts thrown errors into JSON responses.
router.use((err, _req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal error' });
});

module.exports = router;
