const mongoose = require('mongoose');

const leagueMatchSchema = new mongoose.Schema({
  _id: { type: String },
  a: { type: String, ref: 'Player', required: true },
  b: { type: String, ref: 'Player', required: true },
  round: { type: Number, default: 1 },
  winner: { type: String, enum: ['a', 'b', null], default: null },
  score: { type: String, default: '', maxlength: 60 },
  status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
  playedAt: { type: Date, default: null }
}, { _id: false });

const leagueSchema = new mongoose.Schema({
  _id: { type: String },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  status: { type: String, enum: ['active', 'finished'], default: 'active' },
  createdBy: { type: String, ref: 'Player', required: true },
  players: { type: [String], ref: 'Player', default: [] },
  matches: { type: [leagueMatchSchema], default: [] },
  finishedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('League', leagueSchema);
