process.env.PORT = '8091';
process.env.ADMIN_PASSWORD = 'test-admin-pass';
process.env.VAPID_PUBLIC_KEY = '';
process.env.VAPID_PRIVATE_KEY = '';

const { MongoMemoryServer } = require('mongodb-memory-server');
const { spawn } = require('child_process');
const path = require('path');

const API = 'http://127.0.0.1:8091';
const HOST = '127.0.0.1';
let mongod = null;
let server = null;

let failures = 0;
let passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log(`  ✔ ${name}`); }
  else { failures++; console.log(`  ✘ ${name}${extra ? ' → ' + JSON.stringify(extra) : ''}`); }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function jfetch(url, opts) {
  const res = await fetch(API + url, opts);
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

async function waitFor(fn, msg, timeout = 60000, interval = 500) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (await fn()) return true; } catch {}
    await sleep(interval);
  }
  console.error(`  ✘ TIMEOUT esperando: ${msg}`);
  failures++;
  return false;
}

async function main() {
  console.log('▶ Iniciando MongoDB en memoria...');
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('padel-match-test');

  console.log('▶ Levantando servidor API...');
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', d => process.env.TEST_DEBUG && process.stderr.write(String(d)));

  await waitFor(async () => {
    const r = await jfetch('/api/health');
    return r.status === 200 && r.body && r.body.mongo === 'connected';
  }, 'health check (mongo conectado)');

  console.log('▶ CREACIÓN DE JUGADORES');
  const pa = (await jfetch('/api/players', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ana Test', phone: '1111111111', category: '5', password: 'pass1234' }) })).body;
  const pb = (await jfetch('/api/players', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Bruno Test', phone: '2222222222', category: '5', password: 'pass1234' }) })).body;
  const pc = (await jfetch('/api/players', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Carla Test', phone: '3333333333', category: '6', password: 'pass1234' }) })).body;
  const pd = (await jfetch('/api/players', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Diego Test', phone: '4444444444', category: '5', password: 'pass1234' }) })).body;
  ok('registro jugador A', !!pa && !!pa.id);
  ok('registro jugador B', !!pb && !!pb.id);
  ok('registro jugador C', !!pc && !!pc.id);
  ok('registro jugador D', !!pd && !!pd.id);
  const [A, B, C, D] = [pa.id, pb.id, pc.id, pd.id];

  console.log('▶ DISPONIBILIDAD TOGGLE');
  ok('A disponible', (await jfetch(`/api/players/${A}/availability`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ available: true }) })).status === 200);
  ok('B disponible', (await jfetch(`/api/players/${B}/availability`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ available: true }) })).status === 200);
  ok('C disponible', (await jfetch(`/api/players/${C}/availability`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ available: true }) })).status === 200);
  ok('D disponible', (await jfetch(`/api/players/${D}/availability`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ available: true }) })).status === 200);

  console.log('▶ SUMMARY / APP');
  const sum1 = (await jfetch(`/api/app/summary/${A}`)).body;
  ok('summary devuelve me/players/stats/matches/convos/rules/pending/sent', !!sum1 && !!sum1.me && !!Array.isArray(sum1.stats) === false && sum1.stats && Array.isArray(sum1.players) && Array.isArray(sum1.matches) && Array.isArray(sum1.convos) && Array.isArray(sum1.rules) && Array.isArray(sum1.pending) && Array.isArray(sum1.sent));
  ok('summary me.id = playerId', sum1.me && sum1.me.id === A);
  ok('summary incluye a los otros 3 jugadores', sum1.players.length === 3);
  ok('summary plata de compat para cada jugador', sum1.players.every(p => p.compat && typeof p.compat.total === 'number'));
  ok('summary me incluye slots por defecto', Array.isArray(sum1.me.slots) && sum1.me.slots.length === 0);

  console.log('▶ DISPONIBILIDAD (SLOTS)');
  const s1 = await jfetch(`/api/players/${A}/slots`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slots: [{ day: 2, from: '19:00', to: '22:00' }, { day: 'no', from: 'aa', to: 'bb' }] }) });
  ok('slots guardados y sanitizados (inválidos filtrados)', s1.status === 200 && Array.isArray(s1.body.slots) && s1.body.slots.length === 1 && s1.body.slots[0].day === 2);
  const s2 = await jfetch(`/api/players/${B}/slots`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slots: [{ day: 2, from: '20:00', to: '23:00' }] }) });
  ok('slots de B guardados', s2.status === 200 && s2.body.slots.length === 1);
  const s3 = await jfetch(`/api/players/${C}/slots`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slots: [{ day: 5, from: '10:00', to: '11:00' }, { day: 2, from: '10:00', to: '11:00' }, { day: 2, from: '10:00', to: '11:00' }] }) });
  ok('slots de C guardados (duplicado permitido en DB, dedup por UI)', s3.status === 200 && s3.body.slots.length === 3);
  const s4 = await jfetch(`/api/players/${A}/slots`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slots: 5 }) });
  ok('slots inválido no-array rechazado', s4.status === 400);

  console.log('▶ INVITACIONES + AUTO-MATCH');
  const inv = (await jfetch(`/api/invitations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromPlayerId: A, toPlayerId: B, date: '22/09/2026', time: '19:00', court: 'Blindes' }) })).body;
  ok('invitación creada', !!inv && !!inv._id && !!inv.shortId);
  const invId = inv._id;
  const acc = await jfetch(`/api/invitations/${invId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'accepted' }) });
  ok('invitación aceptada', acc.status === 200, { status: acc.status, body: acc.body });
  const matchesA = (await jfetch(`/api/matches/player/${A}`)).body;
  ok('auto-match pendiente creado al aceptar', Array.isArray(matchesA) && matchesA.length === 1 && matchesA[0].status === 'pending' && matchesA[0].inviteId === invId);
  const matchId = matchesA[0].id;

  console.log('▶ REGISTRO DE RESULTADO');
  const r1 = await jfetch(`/api/matches/${matchId}/result`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ winnerTeam: 'A', score: '6-4 6-3', by: A }) });
  ok('resultado cargado (gana A)', r1.status === 201 && r1.body.match && r1.body.match.status === 'completed' && r1.body.match.winnerTeam === 'A');
  const r2 = await jfetch(`/api/matches/${matchId}/result`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ winnerTeam: 'B', score: '6-0', by: B }) });
  ok('resultado duplicado rechazado', r2.status === 400);
  const r3 = await jfetch(`/api/matches/${matchId}/result`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ winnerTeam: 'A', score: '6-1', by: C }) });
  ok('resultado por no-participante rechazado', r3.status === 400);
  const r4 = await jfetch(`/api/matches/${matchId}/result`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ winnerTeam: 'A', score: '', by: A }) });
  ok('resultado sin marcador rechazado', r4.status === 400);

  console.log('▶ STATS');
  const stA = (await jfetch(`/api/players/${A}/stats`)).body;
  const stB = (await jfetch(`/api/players/${B}/stats`)).body;
  ok('stats A: 1 partido, 1 ganado, racha +1', stA.played === 1 && stA.wins === 1 && stA.losses === 0 && stA.streak === 1 && stA.winRate === 100);
  ok('stats B: 1 partido, 1 perdido, racha -1', stB.played === 1 && stB.wins === 0 && stB.losses === 1 && stB.streak === -1 && stB.winRate === 0);
  ok('stats B: aceptó invitación -> acceptRate 100', stB.acceptRate === 100 && stB.received === 1);
  const st0 = (await jfetch(`/api/players/${C}/stats`)).body;
  ok('stats C: sin partidos, sin invitaciones', st0.played === 0 && st0.received === 0 && st0.acceptRate === 100);

  console.log('▶ COMPATIBILIDAD');
  const sum2 = (await jfetch(`/api/app/summary/${A}`)).body;
  const bv = sum2.players.find(p => p.id === B);
  ok('compat A-B alta (mismo nivel + horarios que se solapan)', bv && bv.compat.total === 100, bv && bv.compat);
  const sumB = (await jfetch(`/api/app/summary/${C}`)).body;
  const bFromC = sumB.players.find(p => p.id === A);
  ok('compat C-A con horarios distintos baja la disponibilidad', bFromC && bFromC.compat.avail === 30, bFromC && bFromC.compat);

  console.log('▶ CHAT DIRECTO');
  const convoRaw = (await jfetch(`/api/conversations/with/${A}/${D}`)).body;
  ok('conversación con directa creada', convoRaw && convoRaw.id && Array.isArray(convoRaw.messages));
  const cId = convoRaw.id;
  const m1 = await jfetch(`/api/conversations/${cId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: A, text: 'Hola Diego!' }) });
  ok('mensaje directo enviado', m1.status === 201 && m1.body.text === 'Hola Diego!');
  const convosD = (await jfetch(`/api/conversations/${D}`)).body;
  ok('D ve la conversación con A con 1 no leído', Array.isArray(convosD) && convosD.length === 1 && convosD[0].unread === 1 && convosD[0].group === false);
  const read1 = await jfetch(`/api/conversations/${cId}/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: D }) });
  ok('read marcado', read1.status === 200);
  const convosD2 = (await jfetch(`/api/conversations/${D}`)).body;
  ok('D ya no tiene no leídos', convosD2[0].unread === 0);

  console.log('▶ CHAT GRUPAL');
  const g0 = await jfetch(`/api/conversations/groups`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creatorId: A, name: '', memberIds: [B] }) });
  ok('grupo sin nombre rechazado', g0.status === 400);
  const g1 = await jfetch(`/api/conversations/groups`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creatorId: A, name: 'Partido del jueves', memberIds: [B, C] }) });
  ok('grupo creado', g1.status === 201 && !!g1.body.id);
  const gId = g1.body.id;
  const m2 = await jfetch(`/api/conversations/${gId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: A, text: '¿Alguien confirma?' }) });
  ok('mensaje de grupo enviado', m2.status === 201);
  const convosB = (await jfetch(`/api/conversations/${B}`)).body;
  const grpB = convosB.find(c => c.group === true);
  ok('B ve el grupo en su lista con 1 no leído', !!grpB && grpB.name === 'Partido del jueves' && grpB.members === 3 && grpB.unread === 1);
  const msgsGroup = (await jfetch(`/api/conversations/${gId}/messages`)).body;
  ok('mensajes del grupo incluyen fromName', Array.isArray(msgsGroup) && msgsGroup.length === 1 && msgsGroup[0].fromName === 'Ana Test');
  const readG = await jfetch(`/api/conversations/${gId}/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: B }) });
  ok('read grupo OK', readG.status === 200);
  const convosB2 = (await jfetch(`/api/conversations/${B}`)).body;
  ok('B sin no leídos en el grupo', convosB2.find(c => c.group).unread === 0);
  const sumA2 = (await jfetch(`/api/app/summary/${A}`)).body;
  ok('summary incluye grupo en convos', sumA2.convos.some(c => c.group === true));

  console.log('▶ VAPID VIA ADMIN');
  const webpush = require('web-push');
  const gen = webpush.generateVAPIDKeys();
  const al = await jfetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-admin-pass' }) });
  ok('admin login', al.status === 200 && !!al.body.token);
  const vkNoAuth = await jfetch('/api/admin/vapid', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publicKey: gen.publicKey, privateKey: gen.privateKey }) });
  ok('vapid sin token → 401', vkNoAuth.status === 401);
  const vkBad = await jfetch('/api/admin/vapid', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${al.body.token}` }, body: JSON.stringify({ publicKey: 'no-es-válida', privateKey: 'tampoco' }) });
  ok('vapid inválidas → 400 (no se persisten)', vkBad.status === 400);
  const vk = await jfetch('/api/admin/vapid', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${al.body.token}` }, body: JSON.stringify({ publicKey: gen.publicKey, privateKey: gen.privateKey }) });
  ok('vapid válidas seteadas → enabled true', vk.status === 200 && vk.body.enabled === true && vk.body.publicKey === gen.publicKey, { status: vk.status, body: vk.body });
  const pk = (await jfetch('/api/push/public-key')).body;
  ok('public-key devuelve enabled + clave', pk.enabled === true && pk.publicKey === gen.publicKey);

  console.log('▶ REGLAS');
  ok('reglas presentes', sum1.rules.length >= 10);

  await finish();
}

async function finish() {
  console.log(`\n═══════════════════════════════════`);
  console.log(`RESULTADO: ${passes} pasaron, ${failures} fallaron`);
  if (failures > 0) process.exitCode = 1;
  await cleanup();
}

main().catch(err => {
  console.error('ERROR en tests:', err);
  failures++;
  return finish();
});

async function cleanup() {
  if (server) { try { server.kill(); } catch {} server = null; }
  if (mongod) { try { await mongod.stop(); } catch {} mongod = null; }
}
process.on('exit', () => { if (server) { try { server.kill(); } catch {} } });
process.on('SIGINT', () => { cleanup().then(() => process.exit(1)); });