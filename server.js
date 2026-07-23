const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// ─── MIDDLEWARE ───────────────────────────────────────────
function unsuspendMiddleware(req, res, next) {
  db.checkAndUnsuspend();
  next();
}
app.use(unsuspendMiddleware);

// ─── PLAYERS ────────────────────────────────────────────

// Registrar
app.post('/api/players', (req, res) => {
  const { name, phone, category } = req.body;
  if (!name || !phone || !category) {
    return res.status(400).json({ error: 'Nombre, teléfono y categoría son obligatorios' });
  }
  const existing = db.findPlayerByPhone(phone);
  if (existing) {
    return res.status(409).json({ error: 'Ya existe un jugador con ese teléfono', player: existing });
  }
  const id = uuidv4();
  const player = db.createPlayer(id, name.trim(), phone.trim(), category);
  res.status(201).json(player);
});

// Obtener todos los jugadores
app.get('/api/players', (req, res) => {
  const players = db.getAllPlayers();
  res.json(players);
});

// Obtener jugador por ID
app.get('/api/players/:id', (req, res) => {
  const player = db.getPlayer(req.params.id);
  if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });
  res.json(player);
});

// Cambiar disponibilidad
app.put('/api/players/:id/availability', (req, res) => {
  const { available } = req.body;
  if (available === undefined) return res.status(400).json({ error: 'Disponibilidad requerida' });
  const player = db.toggleAvailability(req.params.id, available);
  if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });
  res.json(player);
});

// Eliminar jugador
app.delete('/api/players/:id', (req, res) => {
  const player = db.getPlayer(req.params.id);
  if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });
  db.deletePlayer(req.params.id);
  res.json({ ok: true });
});

// ─── INVITATIONS ───────────────────────────────────────

// Enviar invitación
app.post('/api/invitations', (req, res) => {
  const { fromPlayerId, toPlayerId } = req.body;
  if (!fromPlayerId || !toPlayerId) {
    return res.status(400).json({ error: 'fromPlayerId y toPlayerId requeridos' });
  }
  if (fromPlayerId === toPlayerId) {
    return res.status(400).json({ error: 'No podés invitarte a vos mismo' });
  }
  const from = db.getPlayer(fromPlayerId);
  const to = db.getPlayer(toPlayerId);
  if (!from || !to) return res.status(404).json({ error: 'Jugador no encontrado' });
  if (to.suspended) return res.status(403).json({ error: 'El jugador está suspendido' });
  if (!to.available) return res.status(403).json({ error: 'El jugador no está disponible' });

  // Verificar que no haya una invitación pendiente al mismo jugador
  const existing = db.getPendingInvitationsForPlayer(toPlayerId);
  const alreadySent = existing.find(i => i.id.startsWith(fromPlayerId));
  if (alreadySent) return res.status(409).json({ error: 'Ya tenés una invitación pendiente con este jugador' });

  const id = uuidv4();
  const inv = db.createInvitation(id, fromPlayerId, toPlayerId);
  res.status(201).json(inv);
});

// Obtener invitaciones pendientes para un jugador
app.get('/api/invitations/pending/:playerId', (req, res) => {
  const invitations = db.getPendingInvitationsForPlayer(req.params.playerId);
  res.json(invitations);
});

// Obtener invitaciones enviadas por un jugador
app.get('/api/invitations/sent/:playerId', (req, res) => {
  const invitations = db.getSentInvitations(req.params.playerId);
  res.json(invitations);
});

// Responder invitación (accept / reject)
app.put('/api/invitations/:id', (req, res) => {
  const { status } = req.body;
  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status debe ser accepted o rejected' });
  }
  const result = db.respondInvitation(req.params.id, status);
  if (!result) return res.status(404).json({ error: 'Invitación no encontrada o ya respondida' });
  res.json(result);
});

// ─── RULES ──────────────────────────────────────────────

app.get('/api/rules', (req, res) => {
  res.json(db.getRules());
});

// ─── SPA fallback ───────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── START ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Padel Match corriendo en puerto ${PORT}`);
});
