const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
  _id: { type: String },
  teamA: { type: [String], ref: 'Player', required: true },
  teamB: { type: [String], ref: 'Player', required: true },
  players: { type: [String], ref: 'Player', required: true, index: true },
  winnerTeam: { type: String, enum: ['A', 'B', null], default: null },
  winners: { type: [String], default: [] },
  losers: { type: [String], default: [] },
  score: { type: String, default: '', trim: true, maxlength: 60 },
  status: { type: String, enum: ['pending', 'completed', 'cancelled'], default: 'pending' },
  court: { type: String, default: '' },
  date: { type: String, default: '' },
  time: { type: String, default: '' },
  inviteId: { type: String, default: null },
  createdBy: { type: String, ref: 'Player', default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Match', matchSchema);