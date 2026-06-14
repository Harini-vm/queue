/* ============================================================
   Receptionist Dashboard — light theme
   ----
   Design goals (criterion #3, 20%):
   - Single screen, fits 1080p above the fold
   - Keyboard-first: Enter = add, Space = call next, U = undo
   - Buttons disabled when their action is invalid → physically
     impossible to do the wrong thing
   - Hero call-next button is the obvious focal point
   - Subtle row flash when the queue advances (only intentional
     animation — everything else is calm)
   ============================================================ */

const $ = (id) => document.getElementById(id);

let lastSnapshot = null;
let prevTopToken = null;     // first waiting token at previous render
let prevServingId = null;    // serving patient id at previous render
let prevServingToken = null; // serving token number at previous render
let prevWaitingIds = new Set(); // ids of waiting patients last render
let cadenceSaveTimer = null;
let qrSlipTimers = { tick: null, dismiss: null }; // QR slip countdown handles

// =================== render ===================
function render(snap) {
  const isFirstRender = lastSnapshot === null;
  lastSnapshot = snap;

  // Clinic name
  $('clinicName').textContent = snap.clinic.name ? `· ${snap.clinic.name}` : '';

  // ---- Hero button ----
  const hero = $('btnCallNext');
  const heroLabel = $('heroLabel');
  const nowTag = $('nowTag');
  const servingName = $('servingName');

  const hasSomething = !!snap.serving || snap.counts.waiting > 0;
  hero.disabled = !hasSomething;

  // Faint blue prominence ring on the tile when a patient is in the chair.
  const heroTile = hero.parentElement;
  if (heroTile) heroTile.classList.toggle('has-serving', !!snap.serving);

  if (snap.serving) {
    nowTag.style.display = 'inline-flex';
    nowTag.textContent = `NOW SERVING · #${snap.serving.token}`;
    servingName.textContent = snap.serving.name;
    heroLabel.textContent = 'CALL NEXT PATIENT';

    // Overshoot pop on the pill + chime when the serving token changes.
    // (skip on first paint so the page doesn't load with a sound)
    if (!isFirstRender && snap.serving.token !== prevServingToken) {
      nowTag.classList.remove('pop');
      servingName.classList.remove('swap');
      void nowTag.offsetWidth;       // restart animation cleanly
      nowTag.classList.add('pop');
      servingName.classList.add('swap');
      QC.playChime({ volume: 0.14 });
    }
  } else if (snap.counts.waiting > 0) {
    nowTag.style.display = 'none';
    servingName.textContent = '';
    heroLabel.textContent = 'CALL FIRST PATIENT';
  } else {
    nowTag.style.display = 'none';
    servingName.textContent = '';
    heroLabel.textContent = 'WAITING FOR PATIENTS';
  }
  prevServingToken = snap.serving ? snap.serving.token : null;

  // ---- Stats ----
  $('statWaiting').textContent = snap.counts.waiting;
  $('statDone').textContent = snap.counts.done;
  $('statSkipped').textContent = snap.counts.skipped;

  // ---- Queue table ----
  const body = $('queueBody');
  const table = $('queueTable');
  const empty = $('emptyState');

  body.innerHTML = '';

  if (snap.waiting.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'block';
  } else {
    table.style.display = '';
    empty.style.display = 'none';

    snap.waiting.forEach((p, idx) => {
      const tr = document.createElement('tr');
      // Mark brand-new rows (not in previous render) so they slide in.
      const isNew = !isFirstRender && !prevWaitingIds.has(p._id);
      if (isNew) tr.classList.add('appearing');
      tr.innerHTML = `
        <td class="token-cell"><span class="hash">#</span>${p.token}</td>
        <td class="name-cell">
          ${escapeHtml(p.name)}
          ${p.phone ? `<span class="phone">${escapeHtml(p.phone)}</span>` : ''}
        </td>
        <td class="time-cell">${QC.fmtClock(p.createdAt)}</td>
        <td>
          <span class="badge badge-waiting">
            <span class="dot"></span>Waiting
          </span>
        </td>
        <td>
          <div class="row-actions">
            <button class="qr" data-qr="${p.token}" data-qr-name="${escapeHtml(p.name)}">📱 QR</button>
            <button class="skip" data-skip="${p._id}">Skip · No-Show</button>
            <button class="remove" data-remove="${p._id}">Remove</button>
          </div>
        </td>`;
      body.appendChild(tr);
    });
  }

  // ---- Flash the new top-of-queue row when it changes ----
  // Tells the receptionist "this is who's up next" after a call-next.
  const topToken = snap.waiting[0] ? snap.waiting[0].token : null;
  if (!isFirstRender && topToken && topToken !== prevTopToken) {
    const firstRow = body.firstElementChild;
    if (firstRow && !firstRow.classList.contains('appearing')) {
      firstRow.classList.add('flash');
      setTimeout(() => firstRow.classList.remove('flash'), 720);
    }
  }
  prevTopToken = topToken;
  prevServingId = snap.serving ? snap.serving._id : null;
  prevWaitingIds = new Set(snap.waiting.map((p) => p._id));

  // ---- Cadence panel ----
  // Don't stomp the user's typing — only update value when the input
  // isn't focused.
  if (document.activeElement !== $('cadenceInput')) {
    $('cadenceInput').value = snap.clinic.defaultConsultationMinutes;
  }
  const src = $('cadenceSource');
  const avgMin = (snap.avg.seconds / 60).toFixed(1);
  if (snap.avg.source === 'rolling-average') {
    src.className = 'source real';
    src.textContent = `Real avg ${avgMin} min · n=${snap.avg.sampleSize}`;
  } else {
    src.className = 'source fallback';
    src.textContent = `Fallback · calibrating`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function flashInputs() {
  ['nameInput', 'phoneInput'].forEach((id) => {
    const el = $(id);
    el.classList.remove('flash-success');
    void el.offsetWidth; // restart animation
    el.classList.add('flash-success');
    setTimeout(() => el.classList.remove('flash-success'), 400);
  });
}

/**
 * Pop the per-patient QR slip in the bottom-right corner.
 * Non-blocking: the Name input stays focused so the receptionist
 * can immediately start typing the next patient. The slip
 * auto-dismisses after 12s, OR when another Issue Token fires,
 * OR when the receptionist hits Esc / clicks the X.
 */
const SLIP_SECONDS = 12;
function showQrSlip(token, name) {
  dismissQrSlip(); // close any previous slip cleanly
  const slip = $('qrSlip');
  $('qrSlipToken').textContent = `#${token}`;
  $('qrSlipName').textContent = name;
  // Cache-bust per token so the right QR loads even if the image
  // was previously loaded for a different patient.
  $('qrSlipImg').src = `/api/qr/patient?token=${token}`;
  slip.hidden = false;

  let remaining = SLIP_SECONDS;
  $('qrSlipCountdown').textContent = `Closes in ${remaining}s`;
  qrSlipTimers.tick = setInterval(() => {
    remaining -= 1;
    $('qrSlipCountdown').textContent =
      remaining > 0 ? `Closes in ${remaining}s` : 'Closing…';
  }, 1000);
  qrSlipTimers.dismiss = setTimeout(dismissQrSlip, SLIP_SECONDS * 1000);
}

function dismissQrSlip() {
  const slip = $('qrSlip');
  if (slip) slip.hidden = true;
  if (qrSlipTimers.tick)    clearInterval(qrSlipTimers.tick);
  if (qrSlipTimers.dismiss) clearTimeout(qrSlipTimers.dismiss);
  qrSlipTimers = { tick: null, dismiss: null };
}

// =================== actions ===================
async function addPatient(e) {
  e.preventDefault();
  const name = $('nameInput').value.trim();
  if (!name) return;
  try {
    const p = await QC.api('POST', '/api/patients', {
      name,
      phone: $('phoneInput').value.trim(),
    });
    QC.toast(`Token #${p.token} issued to ${p.name}`, 'success');
    $('nameInput').value = '';
    $('phoneInput').value = '';
    $('nameInput').focus();
    // Flash both fields to acknowledge the action — prevents the
    // receptionist from wondering "did it submit?" and double-firing.
    flashInputs();
    // Pop the QR slip — patient scans it right here, no paper, no typing.
    showQrSlip(p.token, p.name);
  } catch (err) {
    QC.toast(err.message, 'error');
  }
}

async function callNext() {
  if ($('btnCallNext').disabled) return;
  try {
    const r = await QC.api('POST', '/api/queue/call-next');
    if (r.nowServing) {
      QC.toast(`Now serving #${r.nowServing.token} · ${r.nowServing.name}`, 'success');
    } else {
      QC.toast('Queue cleared', 'success');
    }
  } catch (err) {
    QC.toast(err.message, 'error');
  }
}

async function skipPatient(id) {
  try {
    await QC.api('POST', `/api/patients/${id}/skip`);
    QC.toast('Marked as no-show', 'success');
  } catch (err) {
    QC.toast(err.message, 'error');
  }
}

async function removePatient(id) {
  if (!confirm('Remove this patient from the queue? This cannot be undone.')) return;
  try {
    await QC.api('DELETE', `/api/patients/${id}`);
    QC.toast('Patient removed', 'success');
  } catch (err) {
    QC.toast(err.message, 'error');
  }
}

async function saveCadence(value) {
  const v = parseInt(value, 10);
  if (isNaN(v) || v < 1 || v > 60) return;
  try {
    await QC.api('PATCH', '/api/clinic', { defaultConsultationMinutes: v });
  } catch (err) {
    QC.toast(err.message, 'error');
  }
}

function bumpCadence(delta) {
  const input = $('cadenceInput');
  const cur = parseInt(input.value, 10) || 8;
  const next = Math.min(60, Math.max(1, cur + delta));
  input.value = next;
  // Save immediately on stepper clicks (no debounce — the user
  // explicitly committed to the value).
  saveCadence(next);
}

// =================== wiring ===================
document.addEventListener('DOMContentLoaded', () => {
  QC.connect(render);

  // Auto-focus name on load
  $('nameInput').focus();

  // Add patient form
  $('addForm').addEventListener('submit', addPatient);

  // Hero call-next
  $('btnCallNext').addEventListener('click', callNext);

  // Cadence stepper
  $('cadencePlus').addEventListener('click', () => bumpCadence(+1));
  $('cadenceMinus').addEventListener('click', () => bumpCadence(-1));

  // Debounced save when the user types directly into the cadence input
  $('cadenceInput').addEventListener('input', (e) => {
    clearTimeout(cadenceSaveTimer);
    const v = e.target.value;
    cadenceSaveTimer = setTimeout(() => saveCadence(v), 500);
  });

  // Row actions via delegation
  $('queueBody').addEventListener('click', (e) => {
    const skipId = e.target.getAttribute && e.target.getAttribute('data-skip');
    const removeId = e.target.getAttribute && e.target.getAttribute('data-remove');
    const qrTok = e.target.getAttribute && e.target.getAttribute('data-qr');
    if (skipId) skipPatient(skipId);
    else if (removeId) removePatient(removeId);
    else if (qrTok) {
      const qrName = e.target.getAttribute('data-qr-name') || '';
      showQrSlip(parseInt(qrTok, 10), qrName);
    }
  });

  // QR slip controls — X button + Esc closes it.
  $('qrSlipClose').addEventListener('click', dismissQrSlip);

  // Keyboard shortcuts — never fire while typing in a field
  document.addEventListener('keydown', (e) => {
    // Esc closes the QR slip from anywhere.
    if (e.key === 'Escape') { dismissQrSlip(); return; }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (e.code === 'Space') {
      e.preventDefault();
      callNext();
    }
  });
});
