/* ============================================================
   Shared client helpers — socket setup, formatting, toasts.
   Loaded before every page-specific script.

   Supports two connection-pill markup styles so we can use the
   same helper across the dark-theme display/patient screens and
   the new light-theme receptionist dashboard.
   ============================================================ */

window.QC = (function () {
  function setConnPill(state) {
    const el = document.getElementById('conn');
    if (!el) return;

    // New-style pill (light theme): has a child #connText span and
    // toggles an `.offline` class.
    const txt = document.getElementById('connText');
    if (txt) {
      if (state === 'live') {
        el.classList.remove('offline');
        txt.textContent = 'Live Sync Connected';
      } else if (state === 'reconnecting') {
        el.classList.add('offline');
        txt.textContent = 'Reconnecting…';
      } else {
        el.classList.add('offline');
        txt.textContent = 'Offline';
      }
      return;
    }

    // Old-style pill (dark theme): single element, uses `.live` class.
    if (state === 'live') {
      el.classList.add('live');
      el.innerHTML = '<span class="dot"></span> Live';
    } else if (state === 'reconnecting') {
      el.classList.remove('live');
      el.innerHTML = '<span class="dot"></span> Reconnecting…';
    } else {
      el.classList.remove('live');
      el.innerHTML = '<span class="dot"></span> Offline';
    }
  }

  function connect(onSnapshot) {
    const socket = io({ transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      setConnPill('live');
      // Reconciliation on (re)connect: server pushes a fresh snapshot
      // automatically, but we also explicitly ask for one in case the
      // initial event was missed during the handshake.
      socket.emit('queue:resync');
    });
    socket.on('disconnect', () => setConnPill('reconnecting'));
    socket.on('reconnect_attempt', () => setConnPill('reconnecting'));

    socket.on('queue:snapshot', onSnapshot);
    socket.on('queue:updated', onSnapshot);
    return socket;
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function toast(message, kind = '') {
    // Single-toast policy: replace any existing toast so a fast
    // click stream doesn't stack five overlapping notifications.
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function fmtMin(seconds) {
    if (seconds == null || seconds <= 0) return '< 1 min';
    const m = Math.round(seconds / 60);
    if (m < 1) return '< 1 min';
    if (m === 1) return '1 min';
    return `${m} min`;
  }

  function fmtClock(dateInput) {
    const d = new Date(dateInput);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function fmtAgo(dateInput) {
    const d = new Date(dateInput);
    const sec = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    return `${hr}h ${min % 60}m ago`;
  }

  /**
   * Soft medical-grade chime via Web Audio API.
   * Two short overlapping sine tones (A5 → E6) with a fast attack
   * and 400ms exponential decay. No audio file needed.
   *
   * Browsers block audio until the page has had a user gesture, so
   * this is silent on the very first auto-fire (e.g. a snapshot
   * arriving before any click). After any click anywhere on the page
   * it'll work for the rest of the session.
   *
   * @param {Object} opts
   *   volume: 0–1 (default 0.18 — quiet enough for a clinic)
   */
  function playChime(opts = {}) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = window.__qcAudio || (window.__qcAudio = new AC());
      if (ctx.state === 'suspended') ctx.resume();
      const vol = opts.volume ?? 0.18;
      const now = ctx.currentTime;

      // Tone 1 — D5 (~587.33 Hz), the warm "ding" body
      const osc1 = ctx.createOscillator();
      const g1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now);
      g1.gain.setValueAtTime(0, now);
      g1.gain.linearRampToValueAtTime(vol, now + 0.015);
      g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
      osc1.connect(g1).connect(ctx.destination);
      osc1.start(now); osc1.stop(now + 0.5);

      // Tone 2 — A5 (880 Hz) a hair later, a perfect fifth above —
      // gives it the unmistakable two-tone medical alert character.
      const osc2 = ctx.createOscillator();
      const g2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, now + 0.04);
      g2.gain.setValueAtTime(0, now + 0.04);
      g2.gain.linearRampToValueAtTime(vol * 0.7, now + 0.06);
      g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
      osc2.connect(g2).connect(ctx.destination);
      osc2.start(now + 0.04); osc2.stop(now + 0.5);
    } catch (e) {
      /* audio blocked — silent failure is the right behavior */
    }
  }

  return { connect, api, toast, fmtMin, fmtClock, fmtAgo, setConnPill, playChime };
})();
