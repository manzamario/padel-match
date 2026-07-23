const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.json');

function readDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { players: [], invitations: [], rules: [] };
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// --- INIT ---
function ensureRules() {
  const db = readDb();
  if (db.rules.length === 0) {
    db.rules = [
      { id: 1, content: '1. Mantené actualizado tu estado de disponibilidad. Es obligatorio marcar si estás disponible o no antes de aparecer en el listado.' },
      { id: 2, content: '2. Respondé las invitaciones en menos de 24 horas. Ignorar o dejar en visto se considera falta.' },
      { id: 3, content: '3. Si rechazás una invitación, se registra automáticamente como rechazo.' },
      { id: 4, content: '4. Acumular 3 rechazos = suspensión automática por 1 mes. Quedás cesante.' },
      { id: 5, content: '5. Durante la suspensión no aparecés en el listado ni podés recibir invitaciones.' },
      { id: 6, content: '6. Si reincidís después de la suspensión, la siguiente será de 3 meses.' },
      { id: 7, content: '7. Las invitaciones vencen automáticamente a las 24 horas si no se responden, contando como rechazo.' },
      { id: 8, content: '8. Mantené el respeto. Cualquier falta de respeto puede resultar en expulsión permanente.' },
      { id: 9, content: '9. Si no contestás o dejás en visto, recibirás una notificación de incumplimiento de normas.' }
    ];
    writeDb(db);
  }
}
ensureRules();

// --- PLAYERS ---
function createPlayer(id, name, phone, category) {
  const db = readDb();
  const player = { id, name, phone, category, available: true, rejections: 0, suspended: false, suspendedUntil: null, warnings: 0, createdAt: new Date().toISOString() };
  db.players.push(player);
  writeDb(db);
  return player;
}

function getPlayer(id) {
  return readDb().players.find(p => p.id === id) || null;
}

function findPlayerByPhone(phone) {
  return readDb().players.find(p => p.phone === phone) || null;
}

function getAllPlayers() {
  return readDb().players;
}

function toggleAvailability(id, available) {
  const db = readDb();
  const p = db.players.find(x => x.id === id);
  if (!p) return null;
  p.available = available;
  writeDb(db);
  return p;
}

function addRejection(id) {
  const db = readDb();
  const p = db.players.find(x => x.id === id);
  if (!p) return null;
  p.rejections = (p.rejections || 0) + 1;
  if (p.rejections >= 3) {
    const until = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    p.suspended = true;
    p.suspendedUntil = until;
    p.warnings = (p.warnings || 0) + 1;
  }
  writeDb(db);
  return p;
}

function checkAndUnsuspend() {
  const db = readDb();
  const now = new Date().toISOString();
  let changed = false;
  for (const p of db.players) {
    if (p.suspended && p.suspendedUntil && p.suspendedUntil <= now) {
      p.suspended = false;
      p.suspendedUntil = null;
      p.rejections = 0;
      changed = true;
    }
  }
  if (changed) writeDb(db);
}

function deletePlayer(id) {
  const db = readDb();
  db.players = db.players.filter(p => p.id !== id);
  db.invitations = db.invitations.filter(i => i.fromPlayerId !== id && i.toPlayerId !== id);
  writeDb(db);
}

// --- INVITATIONS ---
function createInvitation(id, fromId, toId) {
  const db = readDb();
  const inv = { id, fromPlayerId: fromId, toPlayerId: toId, status: 'pending', createdAt: new Date().toISOString(), respondedAt: null };
  db.invitations.push(inv);
  writeDb(db);
  return inv;
}

function getInvitation(id) {
  return readDb().invitations.find(i => i.id === id) || null;
}

function getPendingInvitationsForPlayer(playerId) {
  autoExpire();
  const db = readDb();
  return db.invitations
    .filter(i => i.toPlayerId === playerId && i.status === 'pending')
    .map(i => {
      const from = db.players.find(p => p.id === i.fromPlayerId);
      return { ...i, fromName: from ? from.name : 'Desconocido', fromPhone: from ? from.phone : '', fromCategory: from ? from.category : '' };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getSentInvitations(playerId) {
  const db = readDb();
  return db.invitations
    .filter(i => i.fromPlayerId === playerId)
    .map(i => {
      const to = db.players.find(p => p.id === i.toPlayerId);
      return { ...i, toName: to ? to.name : 'Desconocido' };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function respondInvitation(id, status) {
  const db = readDb();
  const inv = db.invitations.find(i => i.id === id);
  if (!inv || inv.status !== 'pending') return null;
  inv.status = status;
  inv.respondedAt = new Date().toISOString();
  writeDb(db);
  if (status === 'rejected') {
    addRejection(inv.toPlayerId);
  }
  return inv;
}

function autoExpire() {
  const db = readDb();
  const limit = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let changed = false;
  for (const inv of db.invitations) {
    if (inv.status === 'pending' && inv.createdAt < limit) {
      inv.status = 'rejected';
      inv.respondedAt = new Date().toISOString();
      changed = true;
      addRejection(inv.toPlayerId);
    }
  }
  if (changed) writeDb(db);
}

// --- RULES ---
function getRules() {
  return readDb().rules;
}

module.exports = {
  createPlayer, getPlayer, getAllPlayers, findPlayerByPhone,
  toggleAvailability, addRejection, checkAndUnsuspend, deletePlayer,
  createInvitation, getInvitation, getPendingInvitationsForPlayer, getSentInvitations,
  respondInvitation, getRules
};
