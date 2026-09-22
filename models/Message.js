const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversation: { type: String, ref: 'Conversation', required: true, index: true },
  from: { type: String, ref: 'Player', required: true },
  text: { type: String, required: true, trim: true, maxlength: 2000 },
  readBy: { type: [String], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('Message', messageSchema);