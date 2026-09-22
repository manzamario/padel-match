const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  _id: { type: String },
  playerId: { type: String, ref: 'Player', required: true, index: true },
  preferenceId: { type: String, default: '' },
  paymentId: { type: String, default: '', index: true },
  planCode: { type: String, enum: ['1m', '3m', '12m'], required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'ARS' },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled', 'refunded'], default: 'pending' },
  statusDetail: { type: String, default: '' },
  raw: { type: mongoose.Schema.Types.Mixed, default: null },
  activatedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Payment', paymentSchema);
