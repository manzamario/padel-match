const mongoose = require('mongoose');

const ruleSchema = new mongoose.Schema({
  content: { type: String, required: true },
  order: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Rule', ruleSchema);
