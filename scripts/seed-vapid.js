const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Config = require('../models/Config');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Seteá MONGODB_URI (o usá render-env.json)');

  let keys = null;
  const file = path.join(__dirname, '..', 'push-keys.json');
  if (fs.existsSync(file)) {
    keys = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    keys = {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
      subject: process.env.VAPID_SUBJECT
    };
  }
  if (!keys || !keys.publicKey || !keys.privateKey) {
    throw new Error('No hay claves VAPID: necesitás push-keys.json o VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY');
  }

  await mongoose.connect(uri);
  await Config.findByIdAndUpdate('vapid', {
    value: {
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: keys.subject || 'mailto:admin@padel-match.app'
    }
  }, { upsert: true });
  console.log('✔ Claves VAPID guardadas en configs/vapid');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('✘', err.message);
  process.exit(1);
});