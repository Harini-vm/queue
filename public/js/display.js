/* ============================================================
   Waiting-room display (the TV on the wall)
   ----
   - One giant token. One giant "ahead" count. One honest ETA line.
   - Never asks the user to click anything.
   - Updates the instant the receptionist clicks Call Next.
   ============================================================ */

const $ = (id) => document.getElementById(id);

let prevServingToken = null;
let isFirstRender = true;

/**
 * Animated swap of the giant token number. Old number slides up
 * and fades out (220ms); new number slides up from below with a
 * soft overshoot (520ms). Plus a chime at the moment the new
 * number lands. This is the "live sync proof" frame in the demo.
 */
function setServingToken(text) {
  const el = $('servingToken');
  el.classList.remove('entering', 'exiting');
  void el.offsetWidth; // restart animation
  el.classList.add('exiting');
  setTimeout(() => {
    el.textContent = text;
    el.classList.remove('exiting');
    el.classList.add('entering');
    QC.playChime({ volume: 0.22 });
    setTimeout(() => el.classList.remove('entering'), 520);
  }, 220);
}

function render(snap) {
  $('clinicName').textContent = snap.clinic.name;

  // Now serving — animated swap on change.
  const nextTokenText = snap.serving ? `#${snap.serving.token}` : '—';
  const tokenChanged = nextTokenText !== prevServingToken;

  if (isFirstRender || !tokenChanged) {
    $('servingToken').textContent = nextTokenText;
  } else {
    setServingToken(nextTokenText);
  }
  // Empty-state styling when there is no patient in the chair.
  $('servingToken').classList.toggle('empty', !snap.serving);

  if (snap.serving) {
    $('servingName').textContent = snap.serving.name;
  } else {
    $('servingName').textContent = 'Waiting for first patient';
  }
  prevServingToken = nextTokenText;

  // Ahead + ETA
  $('waitingCount').textContent = snap.counts.waiting;
  const avgMin = (snap.avg.seconds / 60).toFixed(1);
  if (snap.counts.waiting === 0 && !snap.serving) {
    $('etaLine').textContent = 'No one in queue';
  } else {
    $('etaLine').textContent = `Average consult ${avgMin} min`;
  }

  // Up next chips (first 6)
  const upNext = $('upNext');
  upNext.innerHTML = '';
  snap.waiting.slice(0, 6).forEach((p) => {
    const div = document.createElement('div');
    div.className = 'chip';
    // Show wait as a precise offset (+8m, +16m…) — feels like a
    // train-station departures board, removes ambient anxiety.
    const offsetMin = Math.max(1, Math.round(p.etaSeconds / 60));
    div.innerHTML = `
      <div class="t">#${p.token}</div>
      <div class="n">+${offsetMin}m</div>`;
    upNext.appendChild(div);
  });
  if (snap.waiting.length === 0) {
    upNext.innerHTML = '<div class="chip"><div class="n">No one waiting</div></div>';
  }

  // Data-source label so a curious patient can see this isn't faked.
  if (snap.avg.source === 'rolling-average') {
    $('dataSource').textContent = `Wait time source: rolling average of last ${snap.avg.sampleSize} consultations`;
  } else {
    $('dataSource').textContent = 'Wait time source: clinic default (calibrating)';
  }

  isFirstRender = false;
}

function tickClock() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  $('clock').textContent = `${hh}:${mm}`;
}

document.addEventListener('DOMContentLoaded', () => {
  QC.connect(render);
  tickClock();
  setInterval(tickClock, 30 * 1000);
});
