const Player = require('./models/Player');
const Invitation = require('./models/Invitation');
const Rule = require('./models/Rule');
const Conversation = require('./models/Conversation');
const Message = require('./models/Message');
const PushSubscription = require('./models/PushSubscription');
const Match = require('./models/Match');

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
async function createPlayer(id, name, phone, category, password) {
  const p = await Player.create({ _id: id, name, phone, category, password, isComplete: true });
  return p.toObject();
}

async function getPlayer(id) {
  return await Player.findOne({ _id: id });
}

async function resetPlayerPassword(id, hashedPassword) {
  return await Player.findOneAndUpdate({ _id: id }, { password: hashedPassword }, { new: true });
}

async function findPlayerByPhone(phone) {
  const p = await Player.findOne({ phone });
  return p ? p.toObject() : null;
}

async function verifyPlayerPassword(phone, password) {
  const p = await Player.findOne({ phone });
  if (!p) return null;
  const match = await p.comparePassword(password);
  if (!match) return null;
  return p.toObject();
}

async function findOrCreatePendingPlayer(phone, category) {
  let p = await Player.findOne({ phone });
  if (p) return p.toObject();
  const id = crypto.randomUUID ? crypto.randomUUID() : 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  p = await Player.create({ _id: id, name: '', phone, category, password: '', isComplete: false });
  return p.toObject();
}

async function completeRegistration(id, name, password) {
  const p = await Player.findByIdAndUpdate(id, { name: name.trim(), isComplete: true, password: password }, { new: true });
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
async function deleteInvitation(id) {
  await Invitation.findByIdAndDelete(id);
}

function genShortId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 7; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function createInvitation(id, fromId, toId, date = '', time = '', court = '') {
  let shortId = genShortId();
  const existing = await Invitation.findOne({ shortId });
  if (existing) shortId = genShortId();
  const inv = await Invitation.create({ _id: id, shortId, fromPlayer: fromId, toPlayer: toId, date, time, court });
  return inv.toObject();
}

async function getInvitationByShortId(shortId) {
  const inv = await Invitation.findOne({ shortId });
  return inv ? inv.toObject() : null;
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
    createdAt: inv.createdAt,
    date: inv.date || '',
    time: inv.time || '',
    court: inv.court || ''
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
    shortId: i.shortId || '',
    fromPlayerId: i.fromPlayer._id.toString(),
    fromName: i.fromPlayer.name,
    fromPhone: i.fromPlayer.phone,
    fromCategory: i.fromPlayer.category,
    status: i.status,
    createdAt: i.createdAt,
    date: i.date || '',
    time: i.time || '',
    court: i.court || ''
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
    respondedAt: i.respondedAt,
    date: i.date || '',
    time: i.time || '',
    court: i.court || ''
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

// --- CHAT ---
function makeConvoId() {
  return 'cv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function sortedPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

async function serializeConversation(conv, playerId) {
  const isGroup = conv.type === 'group';
  const base = {
    id: conv._id.toString(),
    group: isGroup,
    name: (isGroup && conv.name) ? conv.name : '',
    members: isGroup ? conv.participants.length : 0,
    updatedAt: conv.updatedAt || conv.createdAt
  };
  const last = conv.lastMessage || {};
  const lastFromP = last.from ? await Player.findById(last.from) : null;
  base.lastMessage = last.text ? { text: last.text, from: last.from || '', fromName: lastFromP ? lastFromP.name : '', at: last.at || null } : null;
  if (isGroup) return base;
  const peers = conv.participants.filter(p => p.toString() !== playerId);
  const peerId = peers[0] || conv.participants[0];
  const peerP = await Player.findById(peerId);
  base.peer = peerP ? { id: peerP._id.toString(), name: peerP.name, phone: peerP.phone, category: peerP.category, available: peerP.available } : { id: peerId.toString(), name: 'Desconocido', phone: '', category: '', available: false };
  return base;
}

async function getUnreadMap(conversationIds, playerId) {
  if (!conversationIds.length) return new Map();
  const rows = await Message.aggregate([
    { $match: { conversation: { $in: conversationIds }, from: { $ne: playerId }, readBy: { $ne: playerId } } },
    { $group: { _id: '$conversation', count: { $sum: 1 } } }
  ]);
  return new Map(rows.map(r => [r._id.toString(), r.count]));
}

async function getOrCreateConversation(aId, bId) {
  if (aId === bId) return null;
  let conv = await Conversation.findOne({ participants: { $all: [aId, bId] }, type: { $ne: 'group' } });
  if (!conv) {
    const [p1, p2] = await Promise.all([Player.findById(aId), Player.findById(bId)]);
    if (!p1 || !p2) return null;
    conv = await Conversation.create({ _id: makeConvoId(), participants: sortedPair(aId, bId) });
  }
  const messages = await Message.find({ conversation: conv._id.toString() }).sort({ createdAt: 1 });
  const names = {};
  for (const m of messages) {
    if (names[m.from] === undefined) {
      const p = await Player.findById(m.from);
      names[m.from] = p ? p.name : 'Desconocido';
    }
  }
  return {
    id: conv._id.toString(),
    peer: (await serializeConversation(conv, aId)).peer,
    messages: messages.map(m => ({
      id: m._id.toString(),
      from: m.from,
      fromName: names[m.from] || 'Desconocido',
      text: m.text,
      at: m.createdAt
    }))
  };
}

async function getConversationsForPlayer(playerId) {
  const convs = await Conversation.find({ participants: playerId }).sort({ updatedAt: -1 }).limit(100);
  const ids = convs.map(c => c._id.toString());
  const unread = await getUnreadMap(ids, playerId);
  const out = [];
  for (const c of convs) {
    const s = await serializeConversation(c, playerId);
    s.unread = unread.get(c._id.toString()) || 0;
    out.push(s);
  }
  return out;
}

async function getConversationMessages(conversationId, since) {
  const q = { conversation: conversationId };
  if (since) q.createdAt = { $gt: new Date(since) };
  const messages = await Message.find(q).sort({ createdAt: 1 }).limit(200);
  const names = {};
  for (const m of messages) {
    if (names[m.from] === undefined) {
      const p = await Player.findById(m.from);
      names[m.from] = p ? p.name : 'Desconocido';
    }
  }
  return messages.map(m => ({
    id: m._id.toString(),
    from: m.from,
    fromName: names[m.from] || 'Desconocido',
    text: m.text,
    at: m.createdAt
  }));
}

async function sendMessage(conversationId, fromId, text) {
  if (!text || !text.trim()) return null;
  const conv = await Conversation.findById(conversationId);
  if (!conv) return null;
  if (!conv.participants.some(p => p.toString() === fromId)) return null;
  const msg = await Message.create({ conversation: conversationId, from: fromId, text: text.trim() });
  conv.lastMessage = { text: text.trim(), from: fromId, at: new Date() };
  await conv.save();
  const p = await Player.findById(fromId);
  return {
    id: msg._id.toString(),
    from: fromId,
    fromName: p ? p.name : 'Desconocido',
    text: msg.text,
    at: msg.createdAt
  };
}

async function markConversationRead(conversationId, playerId) {
  const conv = await Conversation.findById(conversationId);
  if (!conv) return false;
  if (!conv.participants.some(p => p.toString() === playerId)) return false;
  await Message.updateMany(
    { conversation: conversationId, from: { $ne: playerId }, readBy: { $ne: playerId } },
    { $addToSet: { readBy: playerId } }
  );
  return true;
}

async function getUnreadChatCount(playerId) {
  const convs = await Conversation.find({ participants: playerId }).select('_id').lean();
  const ids = convs.map(c => c._id.toString());
  const unread = await getUnreadMap(ids, playerId);
  let total = 0;
  for (const n of unread.values()) total += n;
  return total;
}

// --- PUSH ---
async function savePushSubscription(playerId, subscription) {
  if (!subscription || !subscription.endpoint || !subscription.keys) return null;
  const id = 'ps_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  await PushSubscription.deleteMany({ endpoint: subscription.endpoint });
  const created = await PushSubscription.create({
    _id: id,
    player: playerId,
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth }
  });
  return created.toObject();
}

async function removePushSubscription(endpoint) {
  if (!endpoint) return null;
  const res = await PushSubscription.deleteMany({ endpoint });
  return res.deletedCount > 0;
}

async function getPushSubscriptions(playerId) {
  const subs = await PushSubscription.find({ player: playerId }).lean();
  return subs.map(s => ({ endpoint: s.endpoint, keys: s.keys }));
}

// --- MATCHES / STATS / COMPAT / SLOTS / GROUPS / SUMMARY ---
function makeMatchId() {
  return 'mt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function makeGroupId() {
  return 'cv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

async function createMatchFromInvite(inv) {
  const pluckId = (x) => {
    if (!x) return '';
    if (typeof x === 'string') return x;
    return x._id ? x._id.toString() : (x.id ? x.id.toString() : '');
  };
  const invId = pluckId(inv._id) || pluckId(inv.id);
  if (!invId) return null;
  const existing = await Match.findOne({ inviteId: invId });
  if (existing) return existing.toObject();
  const from = pluckId(inv.fromPlayer) || pluckId(inv.fromPlayerId);
  const to = pluckId(inv.toPlayer);
  const players = [from, to].filter(Boolean);
  if (players.length < 2) return null;
  const m = await Match.create({
    _id: makeMatchId(),
    teamA: [from],
    teamB: [to],
    players,
    inviteId: invId,
    court: inv.court || '',
    date: inv.date || '',
    time: inv.time || '',
    createdBy: from,
    status: 'pending'
  });
  return m.toObject();
}

async function getMatchById(id) {
  const m = await Match.findById(id);
  return m ? m.toObject() : null;
}

async function getMatchesForPlayer(playerId) {
  const matches = await Match.find({ players: playerId }).sort({ createdAt: -1 }).limit(100).populate('players', 'name');
  return matches.map(m => {
    const teamA = (m.teamA || []).map(id => { const p = m.players.find(x => x && x._id.toString() === id); return { id, name: p ? p.name : '?' }; });
    const teamB = (m.teamB || []).map(id => { const p = m.players.find(x => x && x._id.toString() === id); return { id, name: p ? p.name : '?' }; });
    const myTeam = m.teamA.includes(playerId) ? 'A' : (m.teamB.includes(playerId) ? 'B' : null);
    const iWon = m.status === 'completed' && myTeam ? m.winnerTeam === myTeam : null;
    const opponents = m.players
      .filter(x => x && x._id.toString() !== playerId)
      .map(x => ({ id: x._id.toString(), name: x.name || '?' }));
    return {
      id: m._id.toString(),
      inviteId: m.inviteId || null,
      status: m.status,
      score: m.score || '',
      winnerTeam: m.winnerTeam || null,
      court: m.court || '',
      date: m.date || '',
      time: m.time || '',
      createdAt: m.createdAt,
      teamA,
      teamB,
      myTeam,
      iWon,
      opponents
    };
  });
}

async function registerMatchResult(matchId, winnerTeam, score, byPlayerId) {
  const m = await Match.findById(matchId);
  if (!m) return { error: 'Partido no encontrado' };
  if (m.status !== 'pending') return { error: 'Este partido ya tiene un resultado cargado' };
  const pid = byPlayerId.toString();
  if (!m.players.some(p => p.toString() === pid)) return { error: 'No sos parte de este partido' };
  const s = (score || '').toString().trim();
  if (!s) return { error: 'El marcador no puede estar vacío' };
  if (s.length > 60) return { error: 'El marcador es demasiado largo (máx. 60 caracteres)' };
  const team = winnerTeam === 'A' ? 'A' : (winnerTeam === 'B' ? 'B' : null);
  if (!team) return { error: 'Falta indicar quién ganó' };
  const winners = team === 'A' ? (m.teamA || []) : (m.teamB || []);
  const losers = team === 'A' ? (m.teamB || []) : (m.teamA || []);
  m.winnerTeam = team;
  m.winners = winners;
  m.losers = losers;
  m.score = s;
  m.status = 'completed';
  await m.save();
  return { match: m.toObject(), winners, losers };
}

async function buildAllMatchStatsMap() {
  const all = await Match.find({ status: 'completed' }).select('players winners losers createdAt').lean();
  const map = {};
  for (const m of all) {
    const wonSet = new Set((m.winners || []).map(x => x.toString()));
    for (const p of (m.players || [])) {
      const pid = p.toString();
      if (!map[pid]) map[pid] = { played: 0, wins: 0, losses: 0, recent: [] };
      map[pid].played++;
      const won = wonSet.has(pid);
      if (won) map[pid].wins++; else map[pid].losses++;
      map[pid].recent.push({ at: m.createdAt ? m.createdAt.getTime() : 0, won });
    }
  }
  for (const pid of Object.keys(map)) {
    const st = map[pid];
    st.recent.sort((a, b) => b.at - a.at);
    const recent = st.recent.slice(0, 30);
    let streak = 0;
    if (recent.length) {
      const firstWon = recent[0].won;
      for (const r of recent) {
        if (r.won === firstWon) streak += firstWon ? 1 : -1;
        else break;
      }
    }
    st.recent = undefined;
    st.streak = streak;
    st.winRate = st.played ? Math.round((st.wins / st.played) * 100) : null;
  }
  return map;
}

async function buildInvitationStatsMap() {
  const rows = await Invitation.aggregate([
    { $group: {
        _id: '$toPlayer',
        total: { $sum: 1 },
        accepted: { $sum: { $cond: [{ $eq: ['$status', 'accepted'] }, 1, 0] } },
        responded: { $sum: { $cond: [{ $in: ['$status', ['accepted', 'rejected']] }, 1, 0] } }
      } }
  ]);
  const map = {};
  for (const r of rows) {
    const id = r._id ? r._id.toString() : '';
    const total = r.total || 0;
    map[id] = {
      received: total,
      accepted: r.accepted || 0,
      responded: r.responded || 0,
      acceptRate: total ? Math.round(((r.accepted || 0) / total) * 100) : 100,
      responseRate: total ? Math.round(((r.responded || 0) / total) * 100) : 100
    };
  }
  return map;
}

function emptyStats() {
  return { played: 0, wins: 0, losses: 0, winRate: null, streak: 0, received: 0, accepted: 0, responded: 0, acceptRate: 100, responseRate: 100, pendingMatches: 0 };
}

async function getPlayerStats(playerId) {
  const all = await buildAllMatchStatsMap();
  const invs = await buildInvitationStatsMap();
  const stats = { ...emptyStats(), ...(all[playerId] || {}), ...(invs[playerId] || {}) };
  stats.pendingMatches = await Match.countDocuments({ players: playerId, status: 'pending' });
  return stats;
}

function slotsOverlap(slotsA, slotsB) {
  if (!slotsA || !slotsB || !slotsA.length || !slotsB.length) return null;
  for (const a of slotsA) {
    for (const b of slotsB) {
      if (a.day === b.day && a.from < b.to && b.from < a.to) return true;
    }
  }
  return false;
}

function computeCompat(viewer, target, viewerStats, targetStats) {
  const catDiff = Math.abs((parseInt(viewer.category, 10) || 0) - (parseInt(target.category, 10) || 0));
  const catScore = Math.max(0, 100 - catDiff * 15);
  const relScore = Math.round(((viewerStats.acceptRate || 100) + (targetStats.acceptRate || 100)) / 2);
  const overlap = slotsOverlap(viewer.slots, target.slots);
  let availScore = null;
  if (overlap === true) availScore = 100;
  else if (overlap === false) availScore = 30;
  let total;
  if (availScore === null) {
    total = Math.round(catScore * 0.60 + relScore * 0.40);
  } else {
    total = Math.round(catScore * 0.45 + relScore * 0.35 + availScore * 0.20);
  }
  return { total: Math.max(0, Math.min(100, total)), cat: catScore, rel: relScore, avail: availScore };
}

async function setPlayerSlots(playerId, slots) {
  const clean = [];
  for (const s of slots || []) {
    const day = parseInt(s.day, 10);
    const from = (s.from || '').trim();
    const to = (s.to || '').trim();
    if (isNaN(day) || day < 0 || day > 6) continue;
    if (!/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) continue;
    if (from >= to) continue;
    clean.push({ day, from, to });
  }
  if (clean.length > 30) clean.length = 30;
  const p = await Player.findByIdAndUpdate(playerId, { slots: clean }, { new: true });
  return p ? { ...p.toObject(), id: p._id.toString() } : null;
}

async function createGroupConversation(creatorId, name, memberIds) {
  const displayName = (name || '').toString().trim().slice(0, 60);
  if (!displayName) return { error: 'El grupo necesita un nombre' };
  const members = [];
  const pending = new Set([creatorId.toString(), ...(Array.isArray(memberIds) ? memberIds : []).map(m => m.toString())]);
  for (const pid of pending) {
    const exists = await Player.findById(pid);
    if (exists) members.push(pid);
  }
  if (members.length < 2) return { error: 'El grupo necesita al menos 2 jugadores' };
  if (members.length > 30) return { error: 'Máximo 30 jugadores por grupo' };
  const conv = await Conversation.create({ _id: makeGroupId(), type: 'group', name: displayName, participants: members, lastMessage: { text: '', from: '', at: new Date() } });
  return { id: conv._id.toString() };
}

async function getConversationType(id) {
  const conv = await Conversation.findById(id);
  return conv ? { group: conv.type === 'group', participants: (conv.participants || []).map(p => p.toString()), name: conv.name || '' } : null;
}

async function buildAppSummary(playerId) {
  const me = await getPlayer(playerId);
  if (!me) return null;
  const meObj = me.toObject ? me.toObject() : me;
  const [allPlayers, pending, sent, rules, convos, matches, matchStats, invStats] = await Promise.all([
    getAllPlayers(),
    getPendingInvitationsForPlayer(playerId),
    getSentInvitations(playerId),
    getRules(),
    getConversationsForPlayer(playerId),
    getMatchesForPlayer(playerId),
    buildAllMatchStatsMap(),
    buildInvitationStatsMap()
  ]);
  const stats = { ...emptyStats(), ...(matchStats[playerId] || {}), ...(invStats[playerId] || {}) };
  stats.pendingMatches = matches.filter(m => m.status === 'pending').length;
  const statsFor = (pid) => {
    const base = { ...emptyStats(), ...(matchStats[pid] || {}), ...(invStats[pid] || {}) };
    base.pendingMatches = 0;
    return { played: base.played, wins: base.wins, losses: base.losses, winRate: base.winRate, streak: base.streak, acceptRate: base.acceptRate, responseRate: base.responseRate, received: base.received, pendingMatches: base.pendingMatches };
  };
  const players = allPlayers
    .filter(p => p._id && p._id.toString() !== playerId)
    .map(p => {
      const otherStats = statsFor(p._id.toString());
      const compat = computeCompat(meObj, p, stats, otherStats);
      return { ...p, id: p._id.toString(), compat };
    });
  return { me: { ...meObj, id: meObj._id.toString() }, players, pending, sent, rules, convos, matches, stats };
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
  verifyPlayerPassword,
  createPlayer, findOrCreatePendingPlayer, completeRegistration, getPlayer, resetPlayerPassword, getAllPlayers, findPlayerByPhone,
  toggleAvailability, addRejection, checkAndUnsuspend, deletePlayer, resetPlayer,
  deleteInvitation, createInvitation, getInvitationByShortId, getInvitation, getInvitationWithFrom, getPendingInvitationsForPlayer, getSentInvitations,
  respondInvitation, getInvitationStats, getRules, updateCategory,
  getOrCreateConversation, getConversationsForPlayer, getConversationMessages, sendMessage, markConversationRead, getUnreadChatCount,
  createGroupConversation, getConversationType,
  createMatchFromInvite, getMatchById, getMatchesForPlayer, registerMatchResult, getPlayerStats,
  setPlayerSlots, computeCompat, buildAppSummary,
  savePushSubscription, removePushSubscription, getPushSubscriptions,
  getAllPlayersFull, adminSuspendPlayer, adminUnsuspendPlayer, adminAddWarning,
  updateRule, getAdminStats
};
