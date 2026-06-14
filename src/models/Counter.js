const mongoose = require('mongoose');

// Atomic counter — one document per day, e.g. _id "token-2026-06-14".
// Used with findOneAndUpdate({$inc:{seq:1}},{upsert:true}) so two
// receptionists adding patients at the same moment can never collide
// on the same token number.
const CounterSchema = new mongoose.Schema(
  {
    _id: { type: String },
    seq: { type: Number, default: 0 },
  },
  { _id: false }
);

module.exports = mongoose.model('Counter', CounterSchema);
