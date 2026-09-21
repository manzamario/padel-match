const mongoose = require('mongoose');

const invitationSchema = new mongoose.Schema({
  _id: { type: String },
  shortId: { type: String, unique: true },
  fromPlayer: { type: String, ref: 'Player', required: true },
  toPlayer: { type: String, ref: 'Player', required: true },
  date: { type: String, default: '' },
  time: { type: String, default: '' },
  court: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  respondedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Invitation', invitationSchema);
