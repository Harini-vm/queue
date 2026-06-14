/* ============================================================
   Patient phone view
   ----
   Patient types their token. We remember it in localStorage so
   they don't re-enter it on every visit. Every socket snapshot
   we receive re-renders their position — fully live, no refresh.
   ============================================================ */

const $ = (id) => document.getElementById(id);
let myToken = null;
let lastSnap = null;
let prevMyStatus = null;

function render(snap) {
  lastSnap = snap;
  if (myToken == null) return;

  const me =
    (snap.serving && snap.serving.token === myToken && { ...snap.serving, position: 0 }) ||
    snap.waiting.find((p) => p.token === myToken) ||
    snap.recentDone.find((p) => p.token === myToken);

  if (!me) {
    showError('Token not found in today\'s queue.');
    return;
  }

  $('errorMsg').textContent = '';
  $('statusCard').style.display = 'block';
  $('yourToken').textContent = `#${me.token}`;
  $('yourName').textContent = me.name;

  const banner = $('statusBanner');

  if (me.status === 'serving' || me.position === 0) {
    $('aheadCount').textContent = '0';
    $('etaMinutes').textContent = 'now';
    banner.className = 'status-banner now';
    banner.textContent = "It's your turn — please head in.";
    // Chime — but only at the moment of transition into "your turn",
    // not on every snapshot afterwards.
    if (prevMyStatus && prevMyStatus !== 'serving') {
      QC.playChime({ volume: 0.32 });
    }
    prevMyStatus = 'serving';
  } else if (me.status === 'done') {
    $('aheadCount').textContent = '✓';
    $('etaMinutes').textContent = 'done';
    banner.className = 'status-banner';
    banner.textContent = 'Consultation completed.';
    prevMyStatus = 'done';
  } else if (me.status === 'skipped') {
    $('aheadCount').textContent = '—';
    $('etaMinutes').textContent = '—';
    banner.className = 'status-banner';
    banner.textContent = 'Marked as no-show. Ask reception to add you back.';
    prevMyStatus = 'skipped';
  } else {
    const ahead = me.position - 1; // position is 1-based for first in queue
    $('aheadCount').textContent = ahead;
    $('etaMinutes').textContent = QC.fmtMin(me.etaSeconds);
    if (ahead === 0) {
      banner.className = 'status-banner next';
      banner.textContent = "You're next — please stay close.";
      prevMyStatus = 'next';
    } else {
      banner.className = 'status-banner';
      banner.textContent = `Currently serving #${snap.serving ? snap.serving.token : '—'}.`;
      prevMyStatus = 'waiting';
    }
  }
}

function showError(msg) {
  $('errorMsg').textContent = msg;
  $('statusCard').style.display = 'none';
}

function lookup(e) {
  e.preventDefault();
  const v = parseInt($('tokenInput').value, 10);
  if (isNaN(v) || v < 1) return;
  myToken = v;
  localStorage.setItem('qc.token', String(v));
  if (lastSnap) render(lastSnap);
}

document.addEventListener('DOMContentLoaded', () => {
  // 1. Highest priority: ?token=N in the URL — this is the deep link
  //    embedded in the per-patient QR the receptionist shows. Scanning
  //    drops the patient straight onto their live tracking, no typing.
  const urlToken = new URL(window.location.href).searchParams.get('token');
  if (urlToken && /^\d+$/.test(urlToken)) {
    myToken = parseInt(urlToken, 10);
    $('tokenInput').value = urlToken;
    localStorage.setItem('qc.token', urlToken);
  } else {
    // 2. Fallback: restore the last token from localStorage so a refresh
    //    or returning visit keeps tracking the same patient.
    const saved = localStorage.getItem('qc.token');
    if (saved) {
      myToken = parseInt(saved, 10);
      $('tokenInput').value = saved;
    }
  }

  $('lookupForm').addEventListener('submit', lookup);
  QC.connect(render);
});
