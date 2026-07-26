const Player = require('./models/Player');
const Invitation = require('./models/Invitation');
const Rule = require('./models/Rule');

const DEFAULT_RULES = [
  '1. DISPONIBILIDAD OBLIGATORIA: Todo jugador debe mantener actualizado su estado de disponibilidad (disponible/no disponible) en todo momento. Aparecer como "disponible" implica compromiso a responder invitaciones en tiempo y forma.',
  '2. RESPUESTA A INVITACIONES: Toda invitación recibida debe ser respondida dentro de las 24 horas posteriores a su envío. La falta de respuesta dentro de este plazo se considera automáticamente como rechazo.',
  '3. RECHAZOS: Rechazar una invitación —ya sea de forma explícita o por vencimiento del plazo— se registra automáticamente como un rechazo en el historial del jugador.',
  '4. LÍMITE DE RECHAZOS Y SUSPENSIÓN: Al acumular 3 (tres) rechazos, el jugador queda automáticamente suspendido por un período de 30 (treinta) días corridos.',
  '5. EFECTOS DE LA SUSPENSIÓN: Durante el período de suspensión, el jugador no aparecerá en el listado de jugadores disponibles y no podrá recibir ni enviar invitaciones.',
  '6. REINCIDENCIA: Si un jugador es suspendido y, tras cumplir la sanción, vuelve a acumular 3 rechazos, la siguiente suspensión será de 90 (noventa) días corridos.',
  '7. VENCIMIENTO AUTOMÁTICO: Las invitaciones no respondidas dentro de las 24 horas expiran automáticamente y se registran como rechazo, contabilizando en el límite de 3.',
  '8. CONDUCTA Y RESPETO: Se exige trato respetuoso en todo momento. Cualquier falta de respeto, discriminación, acoso o comportamiento inapropiado será evaluado y puede resultar en suspensión temporal o expulsión permanente de la plataforma.',
  '9. NOTIFICACIONES DE INCUMPLIMIENTO: Cada vez que un jugador incurra en una falta (rechazo, expiración, conducta inapropiada), recibirá una notificación automática informando la falta cometida y las consecuencias aplicadas.',
  '10. ADVERTENCIAS: Las suspensiones generan un registro de advertencia en el perfil del jugador. Acumular advertencias puede derivar en sanciones progresivas más severas.',
  '11. USO DE WHATSAPP: Al aceptar una invitación, se abrirá automáticamente un chat de WhatsApp con el jugador que envió la invitación para coordinar los detalles del partido. El uso de este canal es de exclusiva responsabilidad de los jugadores.',
  '12. MODIFICACIÓN DE REGLAS: Padel Match se reserva el derecho de modificar estas reglas en cualquier momento. Los cambios serán notificados y publicados en esta sección.'
];

async function ensureRules() {
  await Rule.deleteMany({});
  await Rule.insertMany(DEFAULT_RULES.map((content, i) => ({ content, order: i + 1 })));
  console.log(`Reglas actualizadas: ${DEFAULT_RULES.length} reglas insertadas`);
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

async function findOrCreatePendingPlayer(phone, category) {
  let p = await Player.findOne({ phone });
  if (p) return p.toObject();
  const id = crypto.randomUUID ? crypto.randomUUID() : 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  p = await Player.create({ _id: id, name: '', phone, category, isComplete: false });
  return p.toObject();
}

async function completeRegistration(id, name) {
  const p = await Player.findByIdAndUpdate(id, { name: name.trim(), isComplete: true }, { new: true });
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

async function updateCategory(id, category) {
  const p = await Player.findByIdAndUpdate(id, { category }, { new: true });
  return p ? p.toObject() : null;
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

async function getInvitationWithFrom(id) {
  const inv = await Invitation.findById(id).populate('fromPlayer', 'name phone category').lean();
  if (!inv) return null;
  return {
    id: inv._id.toString(),
    fromName: inv.fromPlayer?.name || 'Desconocido',
    fromPhone: inv.fromPlayer?.phone || '',
    fromCategory: inv.fromPlayer?.category || '',
    status: inv.status,
    createdAt: inv.createdAt
  };
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

// --- ADMIN ---
async function getAllPlayersFull() {
  const players = await Player.find().sort({ name: 1 }).lean();
  return players.map(p => ({ ...p, id: p._id.toString() }));
}

async function adminSuspendPlayer(id, days) {
  const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const p = await Player.findByIdAndUpdate(id,
    { suspended: true, suspendedUntil: until, rejections: 3 },
    { new: true }
  );
  return p ? { ...p.toObject(), id: p._id.toString() } : null;
}

async function adminUnsuspendPlayer(id) {
  const p = await Player.findByIdAndUpdate(id,
    { suspended: false, suspendedUntil: null, rejections: 0 },
    { new: true }
  );
  return p ? { ...p.toObject(), id: p._id.toString() } : null;
}

async function adminAddWarning(id) {
  const p = await Player.findById(id);
  if (!p) return null;
  p.warnings = (p.warnings || 0) + 1;
  await p.save();
  return { ...p.toObject(), id: p._id.toString() };
}

async function updateRule(id, content) {
  const r = await Rule.findByIdAndUpdate(id, { content }, { new: true });
  return r ? { id: r._id.toString(), content: r.content } : null;
}

async function getAdminStats() {
  const totalPlayers = await Player.countDocuments();
  const activePlayers = await Player.countDocuments({ available: true, suspended: false });
  const suspendedPlayers = await Player.countDocuments({ suspended: true });
  const pendingInvitations = await Invitation.countDocuments({ status: 'pending' });
  const totalInvitations = await Invitation.countDocuments();
  const warnedPlayers = await Player.countDocuments({ warnings: { $gt: 0 } });
  return { totalPlayers, activePlayers, suspendedPlayers, pendingInvitations, totalInvitations, warnedPlayers };
}

module.exports = {
  ensureRules,
  createPlayer, findOrCreatePendingPlayer, completeRegistration, getPlayer, getAllPlayers, findPlayerByPhone,
  toggleAvailability, addRejection, checkAndUnsuspend, deletePlayer, resetPlayer,
  createInvitation, getInvitation, getInvitationWithFrom, getPendingInvitationsForPlayer, getSentInvitations,
  respondInvitation, getInvitationStats, getRules, updateCategory,
  getAllPlayersFull, adminSuspendPlayer, adminUnsuspendPlayer, adminAddWarning,
  updateRule, getAdminStats
};
