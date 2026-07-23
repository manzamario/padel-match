const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  category: { type: String, required: true },
  available: { type: Boolean, default: true },
  rejections: { type: Number, default: 0 },
  suspended: { type: Boolean, default: false },
  suspendedUntil: { type: Date, default: null },
  warnings: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Player', playerSchema);
