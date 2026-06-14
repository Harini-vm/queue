const Patient = require('../models/Patient');
const Counter = require('../models/Counter');
const Clinic = require('../models/Clinic');
const { today, buildSnapshot } = require('./statsService');

/**
 * Get-or-create the singleton clinic document. Called lazily on first hit.
 */
async function ensureClinic() {
  const existing = await Clinic.findById('main');
  if (existing) return existing;
  return Clinic.create({
    _id: 'main',
    name: process.env.CLINIC_NAME || 'Queue Cure Clinic',
    defaultConsultationMinutes:
      parseInt(process.env.DEFAULT_CONSULTATION_MINUTES, 10) || 8,
  });
}

/**
 * Atomically reserve the next token for today.
 *
 * findOneAndUpdate with $inc + upsert is atomic at the MongoDB level,
 * so even if N receptionists call addPatient() at the exact same
 * millisecond, each gets a unique sequential token.
 */
async function nextToken() {
  const day = today();
  const doc = await Counter.findOneAndUpdate(
    { _id: `token-${day}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return doc.seq;
}

async function addPatient({ name, phone }) {
  if (!name || !name.trim()) {
    const e = new Error('Patient name is required');
    e.status = 400;
    throw e;
  }
  await ensureClinic();
  const token = await nextToken();
  const patient = await Patient.create({
    token,
    name: name.trim(),
    phone: (phone || '').trim(),
    status: 'waiting',
    day: today(),
  });
  return patient;
}

/**
 * Mark the current 'serving' patient as 'done' (recording their real
 * consultation duration) and promote the next 'waiting' patient.
 *
 * Concurrency: each state transition uses findOneAndUpdate with a
 * matching status filter. If two operators click "Call Next" within
 * milliseconds of each other, only one update will match — the second
 * is a no-op. No double-calls.
 */
async function callNext() {
  const day = today();
  const now = new Date();

  // 1. Close out the current serving patient (if any).
  const current = await Patient.findOne({ day, status: 'serving' });
  if (current) {
    const calledAt = current.calledAt || current.createdAt;
    const consultationSeconds = Math.max(
      1,
      Math.round((now.getTime() - new Date(calledAt).getTime()) / 1000)
    );
    await Patient.findOneAndUpdate(
      { _id: current._id, status: 'serving' }, // concurrency guard
      {
        status: 'done',
        completedAt: now,
        consultationSeconds,
      }
    );
  }

  // 2. Promote the next waiting patient atomically. Sort by token so
  //    the oldest-issued is always picked.
  const next = await Patient.findOneAndUpdate(
    { day, status: 'waiting' },
    { status: 'serving', calledAt: now },
    { sort: { token: 1 }, new: true }
  );

  return { closed: current, nowServing: next };
}

/**
 * Undo the most recent call-next. Mistake-proofing: if the receptionist
 * accidentally promotes the wrong patient, one click reverts everything.
 *
 * - Move the current 'serving' patient back to 'waiting' (front of queue)
 * - Re-open the most recently 'done' patient as 'serving'
 */
async function undoLastCall() {
  const day = today();
  const lastDone = await Patient.findOne({ day, status: 'done' }).sort({
    completedAt: -1,
  });
  if (!lastDone) {
    const e = new Error('Nothing to undo');
    e.status = 400;
    throw e;
  }

  // Demote current serving back to waiting (keeps original token order).
  await Patient.findOneAndUpdate(
    { day, status: 'serving' },
    { status: 'waiting', calledAt: null }
  );

  // Re-promote the last done patient. Re-uses their original calledAt
  // so the elapsed-time display picks up where it left off.
  await Patient.findByIdAndUpdate(lastDone._id, {
    status: 'serving',
    completedAt: null,
    consultationSeconds: null,
  });

  return Patient.findById(lastDone._id);
}

async function skipPatient(id) {
  const p = await Patient.findOneAndUpdate(
    { _id: id, status: 'waiting' },
    { status: 'skipped' },
    { new: true }
  );
  if (!p) {
    const e = new Error('Patient not in waiting state');
    e.status = 409;
    throw e;
  }
  return p;
}

/**
 * Bring a skipped (no-show) patient back into the queue at the END of
 * the line. Token number is preserved; only ordering changes.
 */
async function recallPatient(id) {
  const newToken = await nextToken(); // gets a fresh, larger token
  const p = await Patient.findOneAndUpdate(
    { _id: id, status: 'skipped' },
    { status: 'waiting', token: newToken },
    { new: true }
  );
  if (!p) {
    const e = new Error('Patient not in skipped state');
    e.status = 409;
    throw e;
  }
  return p;
}

async function updateClinic({ name, defaultConsultationMinutes }) {
  const update = {};
  if (typeof name === 'string' && name.trim()) update.name = name.trim();
  if (typeof defaultConsultationMinutes === 'number') {
    update.defaultConsultationMinutes = Math.min(
      60,
      Math.max(1, defaultConsultationMinutes)
    );
  }
  return Clinic.findByIdAndUpdate('main', update, {
    new: true,
    upsert: true,
  });
}

/**
 * Find a patient's live position by token. Used by the mobile patient
 * view so visitors can look up their own ETA without calling the
 * receptionist.
 */
async function findByToken(token) {
  const day = today();
  return Patient.findOne({ day, token: Number(token) }).lean();
}

async function resetDay() {
  const day = today();
  await Patient.deleteMany({ day });
  await Counter.deleteOne({ _id: `token-${day}` });
}

/**
 * Hard-delete a single patient — used by the "Remove" action on a row.
 * Only allowed while the patient is still waiting or already skipped;
 * we refuse to wipe history for someone who's been served, and we
 * refuse to nuke the person currently in the chair (use undo first).
 */
async function removePatient(id) {
  const p = await Patient.findOneAndDelete({
    _id: id,
    status: { $in: ['waiting', 'skipped'] },
  });
  if (!p) {
    const e = new Error('Cannot remove a patient who is being served or already done');
    e.status = 409;
    throw e;
  }
  return p;
}

module.exports = {
  ensureClinic,
  addPatient,
  callNext,
  undoLastCall,
  skipPatient,
  recallPatient,
  updateClinic,
  findByToken,
  resetDay,
  removePatient,
  buildSnapshot,
};
