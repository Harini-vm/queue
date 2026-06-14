const mongoose = require('mongoose');

const PatientSchema = new mongoose.Schema(
  {
    token: { type: Number, required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    status: {
      type: String,
      enum: ['waiting', 'serving', 'done', 'skipped'],
      default: 'waiting',
      index: true,
    },
    day: { type: String, required: true, index: true }, // YYYY-MM-DD
    calledAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    consultationSeconds: { type: Number, default: null },
  },
  { timestamps: true }
);

// Compound index for the hottest query: "today's queue in order".
PatientSchema.index({ day: 1, status: 1, token: 1 });

module.exports = mongoose.model('Patient', PatientSchema);
