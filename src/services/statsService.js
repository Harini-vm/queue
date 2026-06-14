const Patient = require('../models/Patient');
const Clinic = require('../models/Clinic');

const ROLLING_WINDOW = 10; // last N consultations feed the average

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Rolling average of the most recent completed consultations.
 * Falls back to the receptionist-configured default ONLY when there
 * is no real data yet — i.e. the wait time is never hardcoded once
 * the clinic has served even one patient.
 */
async function getAvgConsultationSeconds() {
  const day = today();

  const recent = await Patient.find({
    day,
    status: 'done',
    consultationSeconds: { $gt: 0 },
  })
    .sort({ completedAt: -1 })
    .limit(ROLLING_WINDOW)
    .select('consultationSeconds')
    .lean();

  if (recent.length > 0) {
    const sum = recent.reduce((s, p) => s + p.consultationSeconds, 0);
    return {
      seconds: Math.round(sum / recent.length),
      source: 'rolling-average',
      sampleSize: recent.length,
    };
  }

  const clinic = await Clinic.findById('main').lean();
  const fallbackMin = clinic?.defaultConsultationMinutes || 8;
  return {
    seconds: fallbackMin * 60,
    source: 'receptionist-default',
    sampleSize: 0,
  };
}

/**
 * Build a full queue snapshot. This is what every client subscribes
 * to and re-renders from. Sending the whole snapshot on every change
 * keeps every browser in lockstep with the DB — no client-side delta
 * reconciliation, no drift.
 */
async function buildSnapshot() {
  const day = today();
  const [serving, waiting, recentDone, avg, clinic] = await Promise.all([
    Patient.findOne({ day, status: 'serving' }).lean(),
    Patient.find({ day, status: 'waiting' }).sort({ token: 1 }).lean(),
    Patient.find({ day, status: 'done' })
      .sort({ completedAt: -1 })
      .limit(5)
      .lean(),
    getAvgConsultationSeconds(),
    Clinic.findById('main').lean(),
  ]);

  // ETA for each waiting patient: position * avg consult time, plus
  // remaining time on the patient currently being served.
  let servingRemaining = 0;
  if (serving && serving.calledAt) {
    const elapsed = (Date.now() - new Date(serving.calledAt).getTime()) / 1000;
    servingRemaining = Math.max(0, avg.seconds - elapsed);
  }

  const waitingWithEta = waiting.map((p, idx) => ({
    ...p,
    position: idx + 1,
    etaSeconds: Math.round(servingRemaining + idx * avg.seconds),
  }));

  return {
    day,
    clinic: clinic || { name: 'Queue Cure Clinic', defaultConsultationMinutes: 8 },
    serving,
    servingRemainingSeconds: Math.round(servingRemaining),
    waiting: waitingWithEta,
    recentDone,
    avg,
    counts: {
      waiting: waiting.length,
      done: await Patient.countDocuments({ day, status: 'done' }),
      skipped: await Patient.countDocuments({ day, status: 'skipped' }),
    },
    serverTime: Date.now(),
  };
}

module.exports = { getAvgConsultationSeconds, buildSnapshot, today };
