const mongoose = require('mongoose');

const invitationSchema = new mongoose.Schema({
  fromPlayer: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', required: true },
  toPlayer: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', required: true },
  status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  respondedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Invitation', invitationSchema);
