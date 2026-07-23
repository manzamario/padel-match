const Player = require('./models/Player');
const Invitation = require('./models/Invitation');
const Rule = require('./models/Rule');

const DEFAULT_RULES = [
  '1. Mantené actualizado tu estado de disponibilidad. Es obligatorio marcar si estás disponible o no antes de aparecer en el listado.',
  '2. Respondé las invitaciones en menos de 24 horas. Ignorar o dejar en visto se considera falta.',
  '3. Si rechazás una invitación, se registra automáticamente como rechazo.',
  '4. Acumular 3 rechazos = suspensión automática por 1 mes. Quedás cesante.',
  '5. Durante la suspensión no aparecés en el listado ni podés recibir invitaciones.',
  '6. Si reincidís después de la suspensión, la siguiente será de 3 meses.',
  '7. Las invitaciones vencen automáticamente a las 24 horas si no se responden, contando como rechazo.',
  '8. Mantené el respeto. Cualquier falta de respeto puede resultar en expulsión permanente.',
  '9. Si no contestás o dejás en visto, recibirás una notificación de incumplimiento de normas.'
];

async function ensureRules() {
  const count = await Rule.countDocuments();
  if (count === 0) {
    await Rule.insertMany(DEFAULT_RULES.map((content, i) => ({ content, order: i + 1 })));
  }
}

// --- PLAYERS ---
async function createPlayer(id, name, phone, category) {
  const p = await Player.create({ _id: id, name, phone, category });
  return p.toObject();
}

async function getPlayer(id) {
  const p = await Player.findById(id);
  return p ? p.toObject() : null;
}

async function findPlayerByPhone(phone) {
  const p = await Player.findOne({ phone });
  return p ? p.toObject() : null;
}

async function getAllPlayers() {
  const players = await Player.find().sort({ name: 1 });
  return players.map(p => p.toObject());
}

async function toggleAvailability(id, available) {
  const p = await Player.findByIdAndUpdate(id, { available }, { new: true });
  return p ? p.toObject() : null;
}

async function addRejection(id) {
  const p = await Player.findById(id);
  if (!p) return null;
  p.rejections = (p.rejections || 0) + 1;
  if (p.rejections >= 3) {
    const until = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    p.suspended = true;
    p.suspendedUntil = until;
    p.warnings = (p.warnings || 0) + 1;
  }
  await p.save();
  return p.toObject();
}

async function checkAndUnsuspend() {
  await Player.updateMany(
    { suspended: true, suspendedUntil: { $lte: new Date() } },
    { $set: { suspended: false, suspendedUntil: null, rejections: 0 } }
  );
}

async function deletePlayer(id) {
  await Invitation.deleteMany({ $or: [{ fromPlayer: id }, { toPlayer: id }] });
  await Player.findByIdAndDelete(id);
}

async function resetPlayer(id) {
  await Player.findByIdAndUpdate(id, { rejections: 0, suspended: false, suspendedUntil: null });
}

// --- INVITATIONS ---
async function createInvitation(id, fromId, toId) {
  const inv = await Invitation.create({ _id: id, fromPlayer: fromId, toPlayer: toId });
  return inv.toObject();
}

async function getInvitation(id) {
  const inv = await Invitation.findById(id);
  return inv ? inv.toObject() : null;
}

async function getPendingInvitationsForPlayer(playerId) {
  await autoExpire();
  const invs = await Invitation.find({ toPlayer: playerId, status: 'pending' })
    .populate('fromPlayer', 'name phone category')
    .sort({ createdAt: -1 });
  return invs.map(i => ({
    id: i._id.toString(),
    fromPlayerId: i.fromPlayer._id.toString(),
    fromName: i.fromPlayer.name,
    fromPhone: i.fromPlayer.phone,
    fromCategory: i.fromPlayer.category,
    status: i.status,
    createdAt: i.createdAt
  }));
}

async function getSentInvitations(playerId) {
  const invs = await Invitation.find({ fromPlayer: playerId })
    .populate('toPlayer', 'name')
    .sort({ createdAt: -1 });
  return invs.map(i => ({
    id: i._id.toString(),
    toName: i.toPlayer ? i.toPlayer.name : 'Desconocido',
    status: i.status,
    createdAt: i.createdAt,
    respondedAt: i.respondedAt
  }));
}

async function respondInvitation(id, status) {
  const inv = await Invitation.findById(id);
  if (!inv || inv.status !== 'pending') return null;
  inv.status = status;
  inv.respondedAt = new Date();
  await inv.save();
  if (status === 'rejected') {
    await addRejection(inv.toPlayer.toString());
  }
  return inv.toObject();
}

async function autoExpire() {
  const limit = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const expired = await Invitation.find({ status: 'pending', createdAt: { $lt: limit } });
  for (const inv of expired) {
    inv.status = 'rejected';
    inv.respondedAt = new Date();
    await inv.save();
    await addRejection(inv.toPlayer.toString());
  }
}

async function getInvitationStats(playerId) {
  const count = await Invitation.countDocuments({ toPlayer: playerId, status: 'pending' });
  return { total: count };
}

// --- RULES ---
async function getRules() {
  const rules = await Rule.find().sort({ order: 1 });
  return rules.map(r => ({ id: r._id, content: r.content }));
}

module.exports = {
  ensureRules,
  createPlayer, getPlayer, getAllPlayers, findPlayerByPhone,
  toggleAvailability, addRejection, checkAndUnsuspend, deletePlayer, resetPlayer,
  createInvitation, getInvitation, getPendingInvitationsForPlayer, getSentInvitations,
  respondInvitation, getInvitationStats, getRules
};
