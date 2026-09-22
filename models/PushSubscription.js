const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema({
  _id: { type: String },
  player: { type: String, ref: 'Player', required: true, index: true },
  endpoint: { type: String, required: true, unique: true },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true }
  }
}, { timestamps: true });

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);