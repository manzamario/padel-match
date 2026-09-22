const mongoose = require('mongoose');

const configSchema = new mongoose.Schema({
  _id: { type: String },
  value: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

module.exports = mongoose.model('Config', configSchema);