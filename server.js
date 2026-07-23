const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/padel-match';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
async function start() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Conectado a MongoDB');
    await db.ensureRules();
    console.log('Reglas inicializadas');
    app.listen(PORT, () => {
      console.log(`Padel Match corriendo en puerto ${PORT}`);
    });
  } catch (err) {
    console.error('Error al conectar a MongoDB:', err.message);
    process.exit(1);
  }
}

start();
