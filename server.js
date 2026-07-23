const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_OPTIONS = {
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000
};

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'running',
    mongo: mongoose.connection.readyState === 1 ? 'connected' : 'connecting',
    uptime: Math.floor(process.uptime())
  });
});

// Middleware: chequea suspensiones vencidas
app.use((req, res, next) => {
  db.checkAndUnsuspend().catch(() => {});
  next();
});

// ─── PLAYERS ────────────────────────────────────────────

app.post('/api/players', async (req, res) => {
  try {
    const { name, phone, category } = req.body;
    if (!name || !phone || !category) {
      return res.status(400).json({ error: 'Nombre, teléfono y categoría son obligatorios' });
    }
    const existing = await db.findPlayerByPhone(phone);
    if (existing) {
      return res.status(409).json({ error: 'Ya existe un jugador con ese teléfono', player: existing });
    }
    const id = uuidv4();
    const player = await db.createPlayer(id, name.trim(), phone.trim(), category);
    res.status(201).json(player);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.get('/api/players', async (req, res) => {
  try {
    const players = await db.getAllPlayers();
    res.json(players);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/players/:id', async (req, res) => {
  try {
    const player = await db.getPlayer(req.params.id);
    if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });
    res.json(player);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.put('/api/players/:id/availability', async (req, res) => {
  try {
    const { available } = req.body;
    if (available === undefined) return res.status(400).json({ error: 'Disponibilidad requerida' });
    const player = await db.toggleAvailability(req.params.id, available);
    if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });
    res.json(player);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.delete('/api/players/:id', async (req, res) => {
  try {
    const player = await db.getPlayer(req.params.id);
    if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });
    await db.deletePlayer(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── INVITATIONS ───────────────────────────────────────

app.post('/api/invitations', async (req, res) => {
  try {
    const { fromPlayerId, toPlayerId } = req.body;
    if (!fromPlayerId || !toPlayerId) {
      return res.status(400).json({ error: 'fromPlayerId y toPlayerId requeridos' });
    }
    if (fromPlayerId === toPlayerId) {
      return res.status(400).json({ error: 'No podés invitarte a vos mismo' });
    }
    const [from, to] = await Promise.all([db.getPlayer(fromPlayerId), db.getPlayer(toPlayerId)]);
    if (!from || !to) return res.status(404).json({ error: 'Jugador no encontrado' });
    if (to.suspended) return res.status(403).json({ error: 'El jugador está suspendido' });
    if (!to.available) return res.status(403).json({ error: 'El jugador no está disponible' });

    const existing = await db.getPendingInvitationsForPlayer(toPlayerId);
    const alreadySent = existing.find(i => i.fromPlayerId === fromPlayerId);
    if (alreadySent) return res.status(409).json({ error: 'Ya tenés una invitación pendiente con este jugador' });

    const id = uuidv4();
    const inv = await db.createInvitation(id, fromPlayerId, toPlayerId);
    res.status(201).json(inv);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/invitations/pending/:playerId', async (req, res) => {
  try {
    const invitations = await db.getPendingInvitationsForPlayer(req.params.playerId);
    res.json(invitations);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/invitations/sent/:playerId', async (req, res) => {
  try {
    const invitations = await db.getSentInvitations(req.params.playerId);
    res.json(invitations);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.put('/api/invitations/:id', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status debe ser accepted o rejected' });
    }
    const result = await db.respondInvitation(req.params.id, status);
    if (!result) return res.status(404).json({ error: 'Invitación no encontrada o ya respondida' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── RULES ──────────────────────────────────────────────

app.get('/api/rules', async (req, res) => {
  try {
    res.json(await db.getRules());
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── SPA fallback ───────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── START ──────────────────────────────────────────────
const MONGO_DIRECT = 'mongodb://padel_user:PadelMatch2024@ac-erfscf9-shard-00-00.ztty11j.mongodb.net:27017,ac-erfscf9-shard-00-01.ztty11j.mongodb.net:27017,ac-erfscf9-shard-00-02.ztty11j.mongodb.net:27017/padel-match?ssl=true&replicaSet=atlas-11uadz-shard-0&authSource=admin';

async function connectMongo(retries = 5) {
  const uris = [MONGO_DIRECT];
  if (MONGODB_URI && MONGODB_URI !== MONGO_DIRECT) uris.push(MONGODB_URI);

  for (const uri of uris) {
    for (let i = 1; i <= retries; i++) {
      try {
        console.log(`Conectando MongoDB (${i}/${retries})...`);
        await mongoose.connect(uri, MONGODB_OPTIONS);
        console.log('Conectado a MongoDB');
        await db.ensureRules();
        console.log('Reglas inicializadas');
        return true;
      } catch (err) {
        console.log(`Intento ${i}/${retries} falló: ${err.message}`);
        if (i < retries) await new Promise(r => setTimeout(r, 3000));
      }
    }
  }
  console.error('No se pudo conectar a MongoDB');
  return false;
}

async function start() {
  app.listen(PORT, () => {
    console.log(`Servidor HTTP corriendo en puerto ${PORT}`);
  });
  connectMongo();
}

start();
