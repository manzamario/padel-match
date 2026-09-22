const Player = require('./models/Player');
const Invitation = require('./models/Invitation');
const Rule = require('./models/Rule');
const Conversation = require('./models/Conversation');
const Message = require('./models/Message');
const PushSubscription = require('./models/PushSubscription');
const Match = require('./models/Match');
const League = require('./models/League');
const SeekingPost = require('./models/SeekingPost');
const Payment = require('./models/Payment');

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
  try {
    await applyMatchRatingAndPoints(winners, losers);
  } catch (e) {
    console.error('applyMatchRatingAndPoints error:', e.message);
  }
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

// --- FASE 2: RATING / LADDER / GAMIFICACIÓN / MAPA ---
const ELO_K = 32;
const ELO_BASE = 1500;

const ACHIEVEMENT_DEFS = [
  { id: 'first_match', icon: '🎾', name: 'Primer partido', desc: 'Completá tu primer partido' },
  { id: 'first_win', icon: '🏆', name: 'Primera victoria', desc: 'Ganá tu primer partido' },
  { id: 'streak_3', icon: '🔥', name: 'Racha x3', desc: '3 victorias seguidas' },
  { id: 'streak_5', icon: '⚡', name: 'Racha x5', desc: '5 victorias seguidas' },
  { id: 'played_10', icon: '🎾', name: '10 partidos', desc: 'Jugá 10 partidos' },
  { id: 'played_25', icon: '🏅', name: '25 partidos', desc: 'Jugá 25 partidos' },
  { id: 'wins_10', icon: '💪', name: '10 victorias', desc: 'Ganá 10 partidos' },
  { id: 'fair_play', icon: '🤝', name: 'Fair play', desc: 'Reputación 90+ con 5+ invitaciones recibidas' },
  { id: 'responsive', icon: '💬', name: 'Respondedor', desc: '100% de respuesta con 3+ invitaciones' }
];

function computeReputation(stats, warnings = 0, rejections = 0) {
  let score = 100;
  const received = stats.received || 0;
  if (received > 0) {
    score = (stats.acceptRate || 0) * 0.5 + (stats.responseRate || 0) * 0.3 + 20;
  }
  score -= (warnings || 0) * 15;
  score -= Math.min(30, (rejections || 0) * 5);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function computeAchievements(stats, reputation) {
  const unlocked = [];
  if ((stats.played || 0) >= 1) unlocked.push('first_match');
  if ((stats.wins || 0) >= 1) unlocked.push('first_win');
  if ((stats.streak || 0) >= 3) unlocked.push('streak_3');
  if ((stats.streak || 0) >= 5) unlocked.push('streak_5');
  if ((stats.played || 0) >= 10) unlocked.push('played_10');
  if ((stats.played || 0) >= 25) unlocked.push('played_25');
  if ((stats.wins || 0) >= 10) unlocked.push('wins_10');
  if (reputation >= 90 && (stats.received || 0) >= 5) unlocked.push('fair_play');
  if ((stats.received || 0) >= 3 && (stats.acceptRate || 0) === 100 && (stats.responseRate || 0) === 100) unlocked.push('responsive');
  return unlocked;
}

function expectedScore(ra, rb) {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

async function applyMatchRatingAndPoints(winners, losers) {
  const ids = [...winners, ...losers].map(String);
  if (!ids.length) return;
  const docs = await Player.find({ _id: { $in: ids } });
  const byId = new Map(docs.map(p => [p._id.toString(), p]));
  const teamRating = (team) => {
    if (!team.length) return ELO_BASE;
    let sum = 0;
    for (const id of team) {
      const p = byId.get(String(id));
      sum += p && typeof p.rating === 'number' ? p.rating : ELO_BASE;
    }
    return sum / team.length;
  };
  const ra = teamRating(winners);
  const rb = teamRating(losers);
  const ea = expectedScore(ra, rb);
  const eb = 1 - ea;
  const deltaWin = Math.round(ELO_K * (1 - ea));
  const deltaLoss = Math.round(ELO_K * (0 - eb));
  const ops = [];
  for (const id of winners) {
    const p = byId.get(String(id));
    if (!p) continue;
    const rating = (typeof p.rating === 'number' ? p.rating : ELO_BASE) + deltaWin;
    const points = (p.points || 0) + 10;
    ops.push(Player.updateOne({ _id: p._id }, { $set: { rating, points } }));
  }
  for (const id of losers) {
    const p = byId.get(String(id));
    if (!p) continue;
    const rating = (typeof p.rating === 'number' ? p.rating : ELO_BASE) + deltaLoss;
    const points = (p.points || 0) + 3;
    ops.push(Player.updateOne({ _id: p._id }, { $set: { rating, points } }));
  }
  if (ops.length) await Promise.all(ops);
}

async function getLadder() {
  const [players, matchStats, invStats] = await Promise.all([
    Player.find({ isComplete: true }).lean(),
    buildAllMatchStatsMap(),
    buildInvitationStatsMap()
  ]);
  const rows = players.map(p => {
    const pid = p._id.toString();
    const stats = { ...emptyStats(), ...(matchStats[pid] || {}), ...(invStats[pid] || {}) };
    const reputation = computeReputation(stats, p.warnings || 0, p.rejections || 0);
    const achievements = computeAchievements(stats, reputation);
    return {
      id: pid,
      name: p.name,
      category: p.category,
      rating: typeof p.rating === 'number' ? p.rating : ELO_BASE,
      points: p.points || 0,
      played: stats.played,
      wins: stats.wins,
      losses: stats.losses,
      winRate: stats.winRate,
      streak: stats.streak,
      reputation,
      achievements,
      available: !!p.available,
      suspended: !!p.suspended
    };
  });
  rows.sort((a, b) => b.rating - a.rating || b.points - a.points || (b.wins || 0) - (a.wins || 0) || String(a.name).localeCompare(String(b.name)));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

async function getAchievementCatalog() {
  return ACHIEVEMENT_DEFS.map(a => ({ ...a }));
}

async function setPlayerLocation(id, lat, lng, shared) {
  if (shared === false || lat == null || lng == null) {
    const p = await Player.findByIdAndUpdate(id, {
      location: { lat: null, lng: null, shared: false, at: null }
    }, { new: true });
    return p ? p.toObject() : null;
  }
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng) || nLat < -90 || nLat > 90 || nLng < -180 || nLng > 180) {
    return { error: 'Coordenadas inválidas' };
  }
  const p = await Player.findByIdAndUpdate(id, {
    location: { lat: nLat, lng: nLng, shared: true, at: new Date() }
  }, { new: true });
  return p ? p.toObject() : null;
}

async function getMapView(viewerId) {
  const players = await Player.find({ isComplete: true, 'location.shared': true }).lean();
  const courtsAgg = await Match.aggregate([
    { $match: { court: { $ne: '' }, status: { $in: ['pending', 'completed'] } } },
    { $group: { _id: '$court', matches: { $sum: 1 }, lastAt: { $max: '$updatedAt' } } },
    { $sort: { matches: -1 } },
    { $limit: 50 }
  ]);
  const spots = courtsAgg.map(c => ({ name: c._id, matches: c.matches || 0, lastAt: c.lastAt || null }));
  return {
    players: players
      .filter(p => p._id.toString() !== viewerId)
      .map(p => ({
        id: p._id.toString(),
        name: p.name,
        category: p.category,
        lat: p.location && p.location.lat,
        lng: p.location && p.location.lng,
        available: !!p.available,
        suspended: !!p.suspended,
        rating: typeof p.rating === 'number' ? p.rating : ELO_BASE
      })),
    spots
  };
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
  const [allPlayers, pending, sent, rules, convos, matches, matchStats, invStats, ladder] = await Promise.all([
    getAllPlayers(),
    getPendingInvitationsForPlayer(playerId),
    getSentInvitations(playerId),
    getRules(),
    getConversationsForPlayer(playerId),
    getMatchesForPlayer(playerId),
    buildAllMatchStatsMap(),
    buildInvitationStatsMap(),
    getLadder()
  ]);
  const stats = { ...emptyStats(), ...(matchStats[playerId] || {}), ...(invStats[playerId] || {}) };
  stats.pendingMatches = matches.filter(m => m.status === 'pending').length;
  const sub = await getSubscription(playerId).catch(() => null);
  const myLadder = ladder.find(r => r.id === playerId) || null;
  const myRank = myLadder ? myLadder.rank : null;
  const reputation = myLadder ? myLadder.reputation : computeReputation(stats, meObj.warnings || 0, meObj.rejections || 0);
  const achievements = myLadder ? myLadder.achievements : computeAchievements(stats, reputation);
  const gamification = {
    rating: typeof meObj.rating === 'number' ? meObj.rating : ELO_BASE,
    points: meObj.points || 0,
    reputation,
    achievements,
    rank: myRank,
    ladderSize: ladder.length
  };
  const statsFor = (pid) => {
    const base = { ...emptyStats(), ...(matchStats[pid] || {}), ...(invStats[pid] || {}) };
    base.pendingMatches = 0;
    return { played: base.played, wins: base.wins, losses: base.losses, winRate: base.winRate, streak: base.streak, acceptRate: base.acceptRate, responseRate: base.responseRate, received: base.received, pendingMatches: base.pendingMatches };
  };
  const ladderById = new Map(ladder.map(r => [r.id, r]));
  const players = allPlayers
    .filter(p => p._id && p._id.toString() !== playerId)
    .map(p => {
      const otherStats = statsFor(p._id.toString());
      const compat = computeCompat(meObj, p, stats, otherStats);
      const lad = ladderById.get(p._id.toString());
      const planPremium = p.plan === 'premium' && (!p.planExpiresAt || p.planExpiresAt > new Date());
      return {
        ...p,
        id: p._id.toString(),
        plan: planPremium ? 'premium' : 'free',
        compat,
        rating: lad ? lad.rating : (typeof p.rating === 'number' ? p.rating : ELO_BASE),
        points: lad ? lad.points : (p.points || 0),
        reputation: lad ? lad.reputation : null,
        rank: lad ? lad.rank : null
      };
    })
    .sort((a, b) => {
      const ap = a.plan === 'premium' ? 1 : 0;
      const bp = b.plan === 'premium' ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return String(a.name).localeCompare(String(b.name));
    });
  return {
    me: { ...meObj, id: meObj._id.toString(), gamification, plan: sub ? sub.plan : 'free', subscription: sub },
    players,
    pending,
    sent,
    rules,
    convos,
    matches,
    stats,
    ladder: ladder.slice(0, 100),
    gamification,
    subscription: sub
  };
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
  const premiumPlayers = await Player.countDocuments({ plan: 'premium', planExpiresAt: { $gt: new Date() } });
  const paid = await Payment.aggregate([
    { $match: { status: 'approved' } },
    { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
  ]);
  return {
    totalPlayers, activePlayers, suspendedPlayers, pendingInvitations, totalInvitations, warnedPlayers,
    premiumPlayers,
    revenue: paid[0] ? paid[0].total : 0,
    paidOrders: paid[0] ? paid[0].count : 0
  };
}

// --- FREEMIUM / PLANES ---
const FREE_LIMITS = {
  invitationsPerMonth: 10,
  activeBoxes: 1,
  openSeekingPosts: 1
};

const PLAN_CATALOG = {
  '1m': { months: 1, label: 'Premium 1 mes', description: 'Invitaciones y boxes ilimitadas, badge 👑 y prioridad en listados.' },
  '3m': { months: 3, label: 'Premium 3 meses', description: 'Todo lo de Premium con 3 meses de acceso.' },
  '12m': { months: 12, label: 'Premium 1 año', description: 'Todo lo de Premium con 12 meses (mejor precio).' }
};

function planAmounts() {
  return {
    '1m': Number(process.env.PREMIUM_PRICE_1M || 3999),
    '3m': Number(process.env.PREMIUM_PRICE_3M || 9999),
    '12m': Number(process.env.PREMIUM_PRICE_12M || 29999)
  };
}

async function refreshPremiumExpiry(playerDoc) {
  if (!playerDoc) return playerDoc;
  if (playerDoc.plan === 'premium' && playerDoc.planExpiresAt && playerDoc.planExpiresAt <= new Date()) {
    playerDoc.plan = 'free';
    playerDoc.planExpiresAt = null;
    await playerDoc.save();
  }
  return playerDoc;
}

async function isPremiumPlayer(playerId) {
  const p = await Player.findById(playerId);
  if (!p) return false;
  await refreshPremiumExpiry(p);
  return p.plan === 'premium';
}

async function getSubscription(playerId) {
  const p = await Player.findById(playerId);
  if (!p) return null;
  await refreshPremiumExpiry(p);
  const premium = p.plan === 'premium';
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const sentThisMonth = premium ? 0 : await Invitation.countDocuments({
    fromPlayer: String(playerId),
    createdAt: { $gte: monthStart }
  });
  const activeBoxes = await League.countDocuments({ createdBy: String(playerId), status: 'active' });
  const openSeeking = await SeekingPost.countDocuments({ playerId: String(playerId), status: 'open' });
  const amounts = planAmounts();
  return {
    plan: premium ? 'premium' : 'free',
    premium,
    planExpiresAt: premium ? p.planExpiresAt : null,
    limits: FREE_LIMITS,
    usage: {
      invitationsSentThisMonth: premium ? null : sentThisMonth,
      invitationsLeft: premium ? null : Math.max(0, FREE_LIMITS.invitationsPerMonth - sentThisMonth),
      activeBoxes,
      boxesLeft: premium ? null : Math.max(0, FREE_LIMITS.activeBoxes - activeBoxes),
      openSeeking,
      seekingLeft: premium ? null : Math.max(0, FREE_LIMITS.openSeekingPosts - openSeeking)
    },
    plans: Object.keys(PLAN_CATALOG).map(code => ({
      code,
      months: PLAN_CATALOG[code].months,
      label: PLAN_CATALOG[code].label,
      description: PLAN_CATALOG[code].description,
      amount: amounts[code],
      currency: 'ARS'
    }))
  };
}

async function checkCanInvite(playerId) {
  const sub = await getSubscription(playerId);
  if (!sub) return { ok: false, error: 'Jugador no encontrado' };
  if (sub.premium) return { ok: true, sub };
  if (sub.usage.invitationsLeft <= 0) {
    return {
      ok: false,
      error: `Alcanzaste el límite free de ${FREE_LIMITS.invitationsPerMonth} invitaciones este mes. Pasate a Premium para enviar ilimitadas.`,
      code: 'LIMIT_INVITES',
      sub
    };
  }
  return { ok: true, sub };
}

async function activatePremium(playerId, months, paymentInfo) {
  const p = await Player.findById(playerId);
  if (!p) return { error: 'Jugador no encontrado' };
  const now = new Date();
  let base = now;
  if (p.plan === 'premium' && p.planExpiresAt && p.planExpiresAt > now) {
    base = new Date(p.planExpiresAt);
  }
  const expires = new Date(base.getTime());
  expires.setMonth(expires.getMonth() + months);
  p.plan = 'premium';
  if (!p.planStartedAt) p.planStartedAt = now;
  p.planExpiresAt = expires;
  await p.save();
  if (paymentInfo && paymentInfo.paymentId) {
    await Payment.findOneAndUpdate(
      { paymentId: String(paymentInfo.paymentId) },
      { $set: { status: 'approved', activatedAt: now, statusDetail: paymentInfo.statusDetail || 'approved' } }
    );
  }
  return { plan: 'premium', planExpiresAt: expires };
}

async function createOrGetPayment(playerId, planCode) {
  const meta = PLAN_CATALOG[planCode];
  if (!meta) return { error: 'Plan inválido' };
  const p = await Player.findById(playerId);
  if (!p || !p.isComplete) return { error: 'Jugador no encontrado' };
  const payment = await Payment.create({
    _id: makeId('pay'),
    playerId: String(playerId),
    planCode,
    amount: planAmounts()[planCode],
    status: 'pending'
  });
  return { payment: payment.toObject(), plan: meta, amount: payment.amount };
}

async function markPaymentApproved(paymentId, raw, statusDetail) {
  const pay = await Payment.findOne({ paymentId: String(paymentId) });
  if (!pay) return null;
  if (pay.status === 'approved') return pay;
  pay.status = 'approved';
  pay.statusDetail = statusDetail || 'approved';
  pay.raw = raw || null;
  pay.activatedAt = new Date();
  await pay.save();
  const meta = PLAN_CATALOG[pay.planCode];
  await activatePremium(pay.playerId, meta ? meta.months : 1, { paymentId: pay.paymentId, statusDetail: pay.statusDetail });
  return pay;
}

async function handleMercadoPagoWebhook(body) {
  try {
    if (!body || body.type !== 'payment' || !body.data || !body.data.id) return { ok: true, ignored: true };
    const paymentId = String(body.data.id);
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) return { ok: false, reason: 'MP no configurado' };
    const resp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) return { ok: false, reason: 'payment fetch failed' };
    const payment = await resp.json();
    const ext = String(payment.external_reference || '');
    let pay = await Payment.findOne({ paymentId });
    if (!pay && ext.startsWith('premium:')) {
      const parts = ext.split(':');
      const pid = parts[2];
      if (pid) {
        pay = await Payment.findOne({ playerId: pid, status: 'pending' }).sort({ createdAt: -1 });
        if (pay) { pay.paymentId = paymentId; await pay.save(); }
      }
    }
    if (payment.status === 'approved') {
      await markPaymentApproved(paymentId, payment, payment.status_detail || 'approved');
      return { ok: true, activated: true };
    }
    if (pay && (payment.status === 'cancelled' || payment.status === 'rejected')) {
      pay.status = payment.status;
      pay.statusDetail = payment.status_detail || payment.status;
      pay.raw = payment;
      await pay.save();
    }
    return { ok: true, activated: false, status: payment.status };
  } catch (e) {
    console.error('MP webhook error:', e.message);
    return { ok: false, reason: e.message };
  }
}

async function confirmPaymentFromReturn(paymentId, playerId) {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token || !paymentId) return { ok: false, error: 'No se pudo verificar el pago' };
  const resp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) return { ok: false, error: 'Pago no encontrado en MercadoPago' };
  const payment = await resp.json();
  if (payment.status !== 'approved') return { ok: false, error: 'Pago aún no aprobado', status: payment.status };
  let pay = await Payment.findOne({ paymentId: String(paymentId) });
  if (!pay && playerId) {
    pay = await Payment.findOne({ playerId, status: 'pending' }).sort({ createdAt: -1 });
    if (pay) { pay.paymentId = String(paymentId); await pay.save(); }
  }
  if (!pay) return { ok: false, error: 'Pago no registrado' };
  await markPaymentApproved(String(paymentId), payment, payment.status_detail || 'approved');
  return { ok: true, plan: await getSubscription(pay.playerId) };
}

// --- FASE 3: BOX LEAGUE ---
function makeId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function generateRoundRobin(playerIds) {
  const ids = [...new Set(playerIds.map(String))];
  if (ids.length < 2) return [];
  const players = ids.slice();
  if (players.length % 2 === 1) players.push(null);
  const n = players.length;
  const arr = players.slice();
  const matches = [];
  let round = 1;
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a && b) {
        matches.push({ _id: makeId('lm'), a, b, round, winner: null, score: '', status: 'pending', playedAt: null });
      }
    }
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr.splice(0, arr.length, fixed, ...rest);
    round++;
  }
  return matches;
}

function buildLeagueStandings(league, playersById) {
  const rows = new Map();
  for (const pid of league.players) {
    rows.set(String(pid), { playerId: String(pid), played: 0, wins: 0, losses: 0, points: 0 });
  }
  for (const m of league.matches || []) {
    if (m.status !== 'completed' || !m.winner) continue;
    const winnerId = m.winner === 'a' ? m.a : m.b;
    const loserId = m.winner === 'a' ? m.b : m.a;
    const w = rows.get(String(winnerId));
    const l = rows.get(String(loserId));
    if (w) { w.played++; w.wins++; w.points += 3; }
    if (l) { l.played++; l.losses++; }
  }
  const out = [...rows.values()].map(r => {
    const p = playersById.get(r.playerId);
    return {
      ...r,
      name: p ? p.name : '?',
      category: p ? p.category : '',
      rating: p && typeof p.rating === 'number' ? p.rating : ELO_BASE
    };
  });
  out.sort((a, b) => b.points - a.points || b.wins - a.wins || a.losses - b.losses || String(a.name).localeCompare(String(b.name)));
  out.forEach((r, i) => { r.rank = i + 1; });
  return out;
}

async function serializeLeague(league, viewerId) {
  const players = await Player.find({ _id: { $in: league.players } }).lean();
  const byId = new Map(players.map(p => [p._id.toString(), p]));
  const nameOf = (id) => { const p = byId.get(String(id)); return p ? p.name : '?'; };
  const standings = buildLeagueStandings(league, byId);
  const myRow = viewerId ? standings.find(s => s.playerId === String(viewerId)) : null;
  return {
    id: league._id,
    name: league.name,
    status: league.status,
    createdBy: league.createdBy,
    players: league.players.map(id => {
      const p = byId.get(String(id));
      return { id: String(id), name: p ? p.name : '?', category: p ? p.category : '' };
    }),
    matches: (league.matches || []).map(m => ({
      id: m._id,
      a: m.a,
      aName: nameOf(m.a),
      b: m.b,
      bName: nameOf(m.b),
      round: m.round,
      winner: m.winner,
      score: m.score,
      status: m.status,
      playedAt: m.playedAt
    })),
    standings,
    myRank: myRow ? myRow.rank : null,
    totalMatches: (league.matches || []).length,
    completedMatches: (league.matches || []).filter(m => m.status === 'completed').length,
    createdAt: league.createdAt
  };
}

async function createLeague(name, createdBy, playerIds) {
  const displayName = (name || '').toString().trim().slice(0, 80);
  if (!displayName) return { error: 'La liga necesita un nombre' };
  const creatorPremium = await isPremiumPlayer(createdBy);
  if (!creatorPremium) {
    const active = await League.countDocuments({ createdBy: String(createdBy), status: 'active' });
    if (active >= FREE_LIMITS.activeBoxes) {
      return { error: `El plan free permite ${FREE_LIMITS.activeBoxes} box activa. Pasate a Premium para tener box ilimitadas.` , code: 'LIMIT_BOXES' };
    }
  }
  const members = [];
  const pending = new Set([String(createdBy), ...(Array.isArray(playerIds) ? playerIds : []).map(x => String(x))]);
  for (const pid of pending) {
    const exists = await Player.findById(pid);
    if (exists) members.push(pid);
  }
  if (members.length < 2) return { error: 'La box necesita al menos 2 jugadores' };
  if (members.length > 12) return { error: 'Máximo 12 jugadores por box' };
  const matches = generateRoundRobin(members);
  const league = await League.create({
    _id: makeId('lg'),
    name: displayName,
    status: 'active',
    createdBy: String(createdBy),
    players: members,
    matches
  });
  return { league: await serializeLeague(league.toObject ? league.toObject() : league, createdBy) };
}

async function getLeagueById(id, viewerId) {
  const league = await League.findById(id);
  if (!league) return null;
  return serializeLeague(league, viewerId);
}

async function getLeaguesForPlayer(playerId) {
  const leagues = await League.find({ players: String(playerId) }).sort({ createdAt: -1 }).limit(50);
  const out = [];
  for (const lg of leagues) out.push(await serializeLeague(lg, playerId));
  return out;
}

async function addLeaguePlayer(leagueId, playerId) {
  const league = await League.findById(leagueId);
  if (!league) return { error: 'Box no encontrada' };
  if (league.status !== 'active') return { error: 'La box ya finalizó' };
  if (league.matches.some(m => m.status === 'completed')) return { error: 'Ya hay resultados: no se pueden agregar jugadores' };
  if (league.players.map(String).includes(String(playerId))) return { error: 'Ya está en la box' };
  if (league.players.length >= 12) return { error: 'Máximo 12 jugadores' };
  const p = await Player.findById(playerId);
  if (!p) return { error: 'Jugador no encontrado' };
  league.players.push(String(playerId));
  league.matches = generateRoundRobin(league.players);
  await league.save();
  return { league: await serializeLeague(league, playerId) };
}

async function registerLeagueResult(leagueId, matchId, winnerSide, score, byPlayerId) {
  const league = await League.findById(leagueId);
  if (!league) return { error: 'Box no encontrada' };
  if (league.status !== 'active') return { error: 'La box ya finalizó' };
  const m = (league.matches || []).find(x => x._id === matchId);
  if (!m) return { error: 'Partido no encontrado' };
  if (m.status === 'completed') return { error: 'Este partido ya tiene resultado' };
  const pid = String(byPlayerId);
  if (m.a !== pid && m.b !== pid) return { error: 'No sos parte de este partido' };
  const s = (score || '').toString().trim();
  if (!s) return { error: 'El marcador no puede estar vacío' };
  if (s.length > 60) return { error: 'Marcador demasiado largo (máx. 60)' };
  const winner = winnerSide === 'a' ? 'a' : (winnerSide === 'b' ? 'b' : null);
  if (!winner) return { error: 'Falta indicar quién ganó' };
  m.winner = winner;
  m.score = s;
  m.status = 'completed';
  m.playedAt = new Date();
  await league.save();
  try {
    const winId = winner === 'a' ? m.a : m.b;
    const loseId = winner === 'a' ? m.b : m.a;
    await applyMatchRatingAndPoints([winId], [loseId]);
  } catch (e) {
    console.error('league rating error:', e.message);
  }
  return { league: await serializeLeague(league, byPlayerId) };
}

async function finishLeague(leagueId) {
  const league = await League.findById(leagueId);
  if (!league) return { error: 'Box no encontrada' };
  league.status = 'finished';
  league.finishedAt = new Date();
  await league.save();
  return { league: await serializeLeague(league, null) };
}

async function deleteLeague(leagueId, byPlayerId) {
  const league = await League.findById(leagueId);
  if (!league) return { error: 'Box no encontrada' };
  if (String(league.createdBy) !== String(byPlayerId)) return { error: 'Solo el creador puede eliminar la box' };
  await League.findByIdAndDelete(leagueId);
  return { ok: true };
}

// --- FASE 3: BUSCO 4TO ---
async function createSeekingPost(playerId, { date, time, court, note, level }) {
  const p = await Player.findById(playerId);
  if (!p) return { error: 'Jugador no encontrado' };
  const premium = await isPremiumPlayer(playerId);
  if (!premium) {
    const open = await SeekingPost.countDocuments({ playerId: String(playerId), status: 'open' });
    if (open >= FREE_LIMITS.openSeekingPosts) {
      return { error: 'El plan free permite 1 publicación abierta a la vez. Pasate a Premium para publicar más.', code: 'LIMIT_SEEKING' };
    }
  }
  const post = await SeekingPost.create({
    _id: makeId('sp'),
    playerId: String(playerId),
    date: (date || '').toString().slice(0, 20),
    time: (time || '').toString().slice(0, 10),
    court: (court || '').toString().slice(0, 60),
    note: (note || '').toString().trim().slice(0, 200),
    level: (level || '').toString().slice(0, 5),
    status: 'open',
    joinedBy: []
  });
  return { post: await serializeSeeking(post) };
}

async function serializeSeeking(post) {
  const owner = await Player.findById(post.playerId).lean();
  const joiners = await Player.find({ _id: { $in: post.joinedBy || [] } }).lean();
  const ownerPlan = owner && owner.plan === 'premium' && (!owner.planExpiresAt || owner.planExpiresAt > new Date()) ? 'premium' : 'free';
  return {
    id: post._id,
    playerId: post.playerId,
    playerName: owner ? owner.name : '?',
    playerCategory: owner ? owner.category : '',
    playerPlan: ownerPlan,
    date: post.date || '',
    time: post.time || '',
    court: post.court || '',
    note: post.note || '',
    level: post.level || '',
    status: post.status,
    joinedBy: (post.joinedBy || []).map(String),
    joinerNames: joiners.map(j => j.name),
    createdAt: post.createdAt
  };
}

async function getSeekingPosts(viewerId) {
  const posts = await SeekingPost.find({ status: 'open' }).sort({ createdAt: -1 }).limit(100);
  const out = [];
  for (const p of posts) {
    if (String(p.playerId) === String(viewerId)) continue;
    out.push(await serializeSeeking(p));
  }
  return out;
}

async function getSeekingPostById(id) {
  const p = await SeekingPost.findById(id);
  return p ? serializeSeeking(p) : null;
}

async function joinSeekingPost(postId, playerId) {
  const post = await SeekingPost.findById(postId);
  if (!post) return { error: 'Publicación no encontrada' };
  if (post.status !== 'open') return { error: 'Esta publicación ya está cerrada' };
  if (String(post.playerId) === String(playerId)) return { error: 'No podés sumarte a tu propia publicación' };
  if ((post.joinedBy || []).map(String).includes(String(playerId))) return { error: 'Ya te sumaste' };
  if ((post.joinedBy || []).length >= 6) return { error: 'Ya hay demasiados interesados' };
  post.joinedBy.push(String(playerId));
  await post.save();
  return { post: await serializeSeeking(post) };
}

async function closeSeekingPost(postId, byPlayerId) {
  const post = await SeekingPost.findById(postId);
  if (!post) return { error: 'Publicación no encontrada' };
  if (String(post.playerId) !== String(byPlayerId)) return { error: 'Solo el dueño puede cerrar' };
  post.status = 'closed';
  await post.save();
  return { ok: true };
}

async function deleteSeekingPost(postId, byPlayerId) {
  const post = await SeekingPost.findById(postId);
  if (!post) return { error: 'Publicación no encontrada' };
  if (String(post.playerId) !== String(byPlayerId) ) return { error: 'Solo el dueño puede eliminar' };
  await SeekingPost.findByIdAndDelete(postId);
  return { ok: true };
}

async function getPlayerProfile(id, viewerId) {
  const p = await Player.findById(id);
  if (!p || !p.isComplete) return null;
  const [stats, ladder, leagues, matches, invStats] = await Promise.all([
    getPlayerStats(id),
    getLadder(),
    getLeaguesForPlayer(id),
    getMatchesForPlayer(id),
    buildInvitationStatsMap()
  ]);
  const lad = ladder.find(r => r.id === String(id));
  const inv = invStats[String(id)] || {};
  const reputation = lad ? lad.reputation : computeReputation({ ...emptyStats(), ...inv }, p.warnings || 0, p.rejections || 0);
  const achievements = lad ? lad.achievements : computeAchievements(stats, reputation);
  const recent = matches.slice(0, 20);
  return {
    player: {
      id: p._id.toString(),
      name: p.name,
      category: p.category,
      available: !!p.available,
      suspended: !!p.suspended,
      rating: typeof p.rating === 'number' ? p.rating : ELO_BASE,
      points: p.points || 0,
      reputation,
      achievements,
      rank: lad ? lad.rank : null,
      ladderSize: ladder.length,
      isMe: viewerId ? String(viewerId) === String(id) : false
    },
    stats: {
      played: stats.played, wins: stats.wins, losses: stats.losses, winRate: stats.winRate,
      streak: stats.streak, acceptRate: stats.acceptRate, responseRate: stats.responseRate,
      received: stats.received, pendingMatches: stats.pendingMatches
    },
    recentMatches: recent,
    leagues: leagues.map(l => ({ id: l.id, name: l.name, status: l.status, myRank: l.myRank, players: l.players.length }))
  };
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
  getLadder, getAchievementCatalog, setPlayerLocation, getMapView, computeReputation, computeAchievements,
  createLeague, getLeagueById, getLeaguesForPlayer, addLeaguePlayer, registerLeagueResult, finishLeague, deleteLeague,
  createSeekingPost, getSeekingPosts, getSeekingPostById, joinSeekingPost, closeSeekingPost, deleteSeekingPost,
  getPlayerProfile,
  FREE_LIMITS, getSubscription, checkCanInvite, isPremiumPlayer, createOrGetPayment, activatePremium,
  markPaymentApproved, handleMercadoPagoWebhook, confirmPaymentFromReturn, planAmounts, PLAN_CATALOG,
  savePushSubscription, removePushSubscription, getPushSubscriptions,
  getAllPlayersFull, adminSuspendPlayer, adminUnsuspendPlayer, adminAddWarning,
  updateRule, getAdminStats
};
