const mongoose = require('mongoose');

const ClinicSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'main' },
    name: { type: String, default: 'Queue Cure Clinic' },
    defaultConsultationMinutes: { type: Number, default: 8, min: 1, max: 60 },
  },
  { timestamps: true, _id: false }
);

module.exports = mongoose.model('Clinic', ClinicSchema);
