const mongoose = require('mongoose');

const invitationSchema = new mongoose.Schema({
  fromPlayer: { type: String, ref: 'Player', required: true },
  toPlayer: { type: String, ref: 'Player', required: true },
  status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  respondedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Invitation', invitationSchema);
