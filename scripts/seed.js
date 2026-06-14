/* ============================================================
   Seed script — drops a realistic clinic snapshot into the DB
   so every demo (and every screenshot) opens on a populated UI.
   Run with: npm run seed
   ----
   Produces today's queue with:
     • 3 patients done (real consultation times → rolling avg active)
     • 1 patient currently being served
     • 1 no-show (skipped)
     • 4 patients waiting in order
   Counter is advanced so the NEXT addPatient gets a clean #10.
   ============================================================ */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const Patient = require('../src/models/Patient');
const Counter = require('../src/models/Counter');
const Clinic = require('../src/models/Clinic');

const MIN = 60 * 1000;
const now = Date.now();
const day = new Date().toISOString().slice(0, 10);

// All durations in minutes-from-now. Negative = in the past.
const ROSTER = [
  // ---- already finished ----
  { token: 1, name: 'Asha Patel',     phone: '+91 98765 43210', status: 'done',
    created: -92, called: -62, completed: -54 }, //  8 min consult
  { token: 2, name: 'Ravi Kumar',     phone: '+91 98810 12233', status: 'done',
    created: -85, called: -54, completed: -47 }, //  7 min consult
  { token: 3, name: 'Meera Sharma',   phone: '',                status: 'done',
    created: -78, called: -47, completed: -41 }, //  6 min consult

  // ---- no-show ----
  { token: 4, name: 'Arjun Reddy',    phone: '+91 99887 65432', status: 'skipped',
    created: -70 },

  // ---- being served right now ----
  { token: 5, name: 'Priya Iyer',     phone: '+91 90123 45678', status: 'serving',
    created: -68, called: -5 },                  //  in the chair for ~5 min

  // ---- waiting in arrival order ----
  { token: 6, name: 'Vikram Singh',   phone: '+91 91234 56789', status: 'waiting',
    created: -52 },
  { token: 7, name: 'Anjali Verma',   phone: '',                status: 'waiting',
    created: -38 },
  { token: 8, name: 'Rahul Joshi',    phone: '+91 93210 11122', status: 'waiting',
    created: -22 },
  { token: 9, name: 'Deepa Nair',     phone: '+91 94000 77777', status: 'waiting',
    created: -9 },
];

function minutesAgo(min) {
  return new Date(now + min * MIN);
}

(async () => {
  try {
    await connectDB();

    // Wipe today only — yesterday's analytics stay intact.
    const wiped = await Patient.deleteMany({ day });
    console.log(`  cleared ${wiped.deletedCount} existing patients for ${day}`);

    // Reset today's token counter to the highest seeded token so that the
    // next addPatient() call gets sequence + 1 (= 10 here).
    const maxToken = Math.max(...ROSTER.map((r) => r.token));
    await Counter.findOneAndUpdate(
      { _id: `token-${day}` },
      { $set: { seq: maxToken } },
      { upsert: true }
    );
    console.log(`  counter for ${day} set to ${maxToken}`);

    // Ensure clinic singleton exists.
    await Clinic.findByIdAndUpdate(
      'main',
      {
        name: process.env.CLINIC_NAME || 'Sunrise Family Clinic',
        defaultConsultationMinutes:
          parseInt(process.env.DEFAULT_CONSULTATION_MINUTES, 10) || 8,
      },
      { upsert: true, new: true }
    );

    // Build documents with explicit timestamps (bypassing Mongoose's
    // auto-stamp by using the native collection insert).
    const docs = ROSTER.map((r) => {
      const doc = {
        token: r.token,
        name: r.name,
        phone: r.phone,
        status: r.status,
        day,
        createdAt: minutesAgo(r.created),
        updatedAt: minutesAgo(r.created),
        calledAt: null,
        completedAt: null,
        consultationSeconds: null,
      };
      if (r.called != null) {
        doc.calledAt = minutesAgo(r.called);
        doc.updatedAt = doc.calledAt;
      }
      if (r.completed != null) {
        doc.completedAt = minutesAgo(r.completed);
        doc.updatedAt = doc.completedAt;
        doc.consultationSeconds = Math.round(
          (doc.completedAt - doc.calledAt) / 1000
        );
      }
      return doc;
    });

    await Patient.collection.insertMany(docs);

    console.log(`  inserted ${docs.length} patients`);
    console.log('     · 3 done (rolling avg should be ~7 min)');
    console.log('     · 1 serving — Priya Iyer (#5)');
    console.log('     · 1 skipped — Arjun Reddy (#4)');
    console.log('     · 4 waiting — Vikram, Anjali, Rahul, Deepa');
    console.log('\nNext addPatient() will issue token #' + (maxToken + 1));
    console.log('Run `npm start` and open http://localhost:3000');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
})();
