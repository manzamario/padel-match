const mongoose = require('mongoose');

const invitationSchema = new mongoose.Schema({
  fromPlayer: { type: String, ref: 'Player', required: true },
  toPlayer: { type: String, ref: 'Player', required: true },
  date: { type: String, default: '' },
  time: { type: String, default: '' },
  court: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  respondedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Invitation', invitationSchema);
