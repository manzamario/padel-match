const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  _id: { type: String },
  type: { type: String, enum: ['direct', 'group'], default: 'direct' },
  name: { type: String, default: '', trim: true, maxlength: 60 },
  participants: { type: [String], ref: 'Player', required: true },
  lastMessage: {
    text: { type: String, default: '' },
    from: { type: String, default: '' },
    at: { type: Date, default: null }
  }
}, { timestamps: true });

module.exports = mongoose.model('Conversation', conversationSchema);