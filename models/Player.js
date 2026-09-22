const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const playerSchema = new mongoose.Schema({
  _id: { type: String },
  name: { type: String, default: '' },
  phone: { type: String, required: true, unique: true },
  category: { type: String, required: true },
  password: { type: String, required: true },
  available: { type: Boolean, default: false },
  isComplete: { type: Boolean, default: false },
  rejections: { type: Number, default: 0 },
  suspended: { type: Boolean, default: false },
  suspendedUntil: { type: Date, default: null },
  warnings: { type: Number, default: 0 },
  isAdmin: { type: Boolean, default: false },
  slots: {
    type: [{
      day: { type: Number, min: 0, max: 6 },
      from: { type: String },
      to: { type: String }
    }],
    default: []
  }
}, {
  timestamps: true,
  toObject: { virtuals: true },
  toJSON: { virtuals: true }
});

playerSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

playerSchema.methods.comparePassword = async function(candidate) {
  return bcrypt.compare(candidate, this.password);
};

playerSchema.virtual('id').get(function() { return this._id; });

module.exports = mongoose.model('Player', playerSchema);
