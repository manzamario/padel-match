const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
  _id: { type: String },
  name: { type: String, default: '' },
  phone: { type: String, required: true, unique: true },
  category: { type: String, required: true },
  available: { type: Boolean, default: true },
  isComplete: { type: Boolean, default: false },
  rejections: { type: Number, default: 0 },
  suspended: { type: Boolean, default: false },
  suspendedUntil: { type: Date, default: null },
  warnings: { type: Number, default: 0 },
  isAdmin: { type: Boolean, default: false }
}, {
  timestamps: true,
  toObject: { virtuals: true },
  toJSON: { virtuals: true }
});

playerSchema.virtual('id').get(function() { return this._id; });

module.exports = mongoose.model('Player', playerSchema);
