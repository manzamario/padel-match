const mongoose = require('mongoose');

const seekingSchema = new mongoose.Schema({
  _id: { type: String },
  playerId: { type: String, ref: 'Player', required: true, index: true },
  date: { type: String, default: '' },
  time: { type: String, default: '' },
  court: { type: String, default: '' },
  note: { type: String, default: '', maxlength: 200 },
  level: { type: String, default: '' },
  status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
  joinedBy: { type: [String], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('SeekingPost', seekingSchema);
