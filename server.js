const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const webpush = require('web-push');
const db = require('./database');
const Player = require('./models/Player');
const Invitation = require('./models/Invitation');

const app = express();
const PORT = process.env.PORT || 8080;
app.set('trust proxy', 1);
const MONGODB_URI = process.env.MONGODB_URI;

// Soporte para variables individuales
const MONGO_USER = process.env.MONGO_USER;
const MONGO_PASS = process.env.MONGO_PASS;
const MONGO_HOSTS = process.env.MONGO_HOSTS;
const MONGO_DB = process.env.MONGO_DB || 'padel-match';

function buildMongoURI() {
  if (MONGODB_URI) return MONGODB_URI;
  if (MONGO_USER && MONGO_PASS && MONGO_HOSTS) {
    return `mongodb://${MONGO_USER}:${MONGO_PASS}@${MONGO_HOSTS}/${MONGO_DB}?ssl=true&replicaSet=atlas-11uadz-shard-0&authSource=admin`;
  }
  return 'mongodb://localhost:27017/padel-match';
}

const MONGODB_OPTIONS = {
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000
};

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://padel-match-p50g.onrender.com';

// ─── WEB PUSH (VAPID) ─────────────────────────────────
const fs = require('fs');
const Config = require('./models/Config');
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@padel-match.app';

// Jerarquía de claves: 1) env vars, 2) push-keys.json local (gitignored), 3) MongoDB (configs/vapid)
let pushReady = false;
let vapidPublicKey = null;

function applyVapid(pub, priv, subject) {
  webpush.setVapidDetails(subject || VAPID_SUBJECT, pub, priv);
  vapidPublicKey = pub;
  pushReady = true;
}

async function ensureVapid() {
  if (pushReady) return true;
  try {
    if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
      applyVapid(VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT);
      return true;
    }
    const file = path.join(__dirname, 'push-keys.json');
    if (fs.existsSync(file)) {
      const keys = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (keys.publicKey && keys.privateKey) {
        applyVapid(keys.publicKey, keys.privateKey, keys.subject || VAPID_SUBJECT);
        return true;
      }
    }
    if (mongoose.connection.readyState === 1) {
      const cfg = await Config.findById('vapid').lean();
      if (cfg && cfg.value && cfg.value.publicKey && cfg.value.privateKey) {
        applyVapid(cfg.value.publicKey, cfg.value.privateKey, cfg.value.subject || VAPID_SUBJECT);
        console.log('VAPID cargado desde MongoDB');
        return true;
      }
    }
  } catch (err) {
    console.error('VAPID setup error:', err.message);
  }
  return pushReady;
}
ensureVapid().catch(() => {});

async function sendPushToPlayer(toPlayerId, title, body, url) {
  if (!toPlayerId) return;
  if (!(await ensureVapid())) return;
  const subs = await db.getPushSubscriptions(toPlayerId).catch(() => []);
  if (!subs.length) return;
  const payload = JSON.stringify({ title, body, url: url || '/', icon: '/Logo.png', badge: '/Logo.png' });
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.removePushSubscription(sub.endpoint).catch(() => {});
      }
    }
  }
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https://ipfs.io", "https://*.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'"],
      frameSrc: ["https://wa.me"],
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(helmet.hidePoweredBy());
app.use(helmet.referrerPolicy({ policy: 'no-referrer' }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intentá de nuevo más tarde' },
});
app.use(limiter);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intentá de nuevo más tarde' },
});
app.use('/api/admin', apiLimiter);
app.use('/api/invitations', apiLimiter);
app.use('/api/push', apiLimiter);
app.use('/api/matches', apiLimiter);
app.use('/api/app', apiLimiter);

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    try {
      const url = new URL(origin);
      const hostname = url.hostname;
      if (hostname === 'padel-match-p50g.onrender.com' || hostname === new URL(FRONTEND_ORIGIN).hostname) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    } catch {
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
}));
app.use(express.json({ limit: '1mb' }));
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
    const { name, phone, category, password } = req.body;
    if (!name || !phone || !category || !password) {
      return res.status(400).json({ error: 'Nombre, teléfono, categoría y contraseña son obligatorios' });
    }
    const existing = await db.findPlayerByPhone(phone);
    if (existing) {
      return res.status(409).json({ error: 'Ya existe un jugador con ese teléfono', player: existing });
    }
    const id = uuidv4();
    const player = await db.createPlayer(id, name.trim(), phone.trim(), category, password);
    res.status(201).json(player);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
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

app.get('/api/players/by-phone/:phone', async (req, res) => {
  try {
    const player = await db.findPlayerByPhone(req.params.phone);
    if (!player) return res.status(404).json({ error: 'No encontrado' });
    res.json({ id: player._id.toString(), name: player.name, phone: player.phone, category: player.category });
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

app.patch('/api/players/:id', async (req, res) => {
  try {
    const { category } = req.body;
    if (!category) return res.status(400).json({ error: 'Categoría requerida' });
    const player = await db.getPlayer(req.params.id);
    if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });
    const updated = await db.updateCategory(req.params.id, category);
    res.json(updated);
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
    const { fromPlayerId, toPlayerId, date, time, court } = req.body;
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
    if (alreadySent) return res.status(409).json({ error: 'Ya tenés una invitación pendiente con este jugador', invitationId: alreadySent.id, shortId: alreadySent.shortId });

    const id = uuidv4();
    const inv = await db.createInvitation(id, fromPlayerId, toPlayerId, date || '', time || '', court || '');
    const detail = [
      date ? `📅 ${date}` : '',
      time ? `🕒 ${time}` : '',
      court ? `📍 ${court}` : ''
    ].filter(Boolean).join(' ');
    sendPushToPlayer(toPlayerId, `${from.name} te invitó a jugar 🎾`, detail || 'Mirá tu invitación en la app', '/');
    res.status(201).json(inv);
  } catch (err) {
    console.error('POST /api/invitations error:', err.message);
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

app.get('/i/:shortId', async (req, res) => {
  try {
    const inv = await db.getInvitationByShortId(req.params.shortId);
    if (!inv) return res.status(404).send('<html><body style="font-family:sans-serif;padding:40px;text-align:center;background:#0a0a0f;color:#f0f0f5;"><h2>Invitación no encontrada</h2></body></html>');
    res.redirect(`/api/invitations/${inv._id}/respond?status=accepted`);
  } catch (err) {
    res.redirect('/');
  }
});

app.get('/i/:shortId/rechazar', async (req, res) => {
  try {
    const inv = await db.getInvitationByShortId(req.params.shortId);
    if (!inv) return res.status(404).send('<html><body style="font-family:sans-serif;padding:40px;text-align:center;background:#0a0a0f;color:#f0f0f5;"><h2>Invitación no encontrada</h2></body></html>');
    res.redirect(`/api/invitations/${inv._id}/respond?status=rejected`);
  } catch (err) {
    res.redirect('/');
  }
});

app.get('/api/invitations/:id/respond', async (req, res) => {
  try {
    const { status } = req.query;
    if (!['accepted', 'rejected'].includes(status)) {
      return res.status(400).send('<html><body style="font-family:sans-serif;padding:40px;text-align:center;background:#0a0a0f;color:#f0f0f5;"><h2>Enlace inválido</h2></body></html>');
    }
     const inv = await db.getInvitation(req.params.id);
    if (!inv) return res.status(404).send('<html><body style="font-family:sans-serif;padding:40px;text-align:center;background:#0a0a0f;color:#f0f0f5;"><h2>Invitación no encontrada</h2></body></html>');
    if (inv.status !== 'pending') return res.status(400).send('<html><body style="font-family:sans-serif;padding:40px;text-align:center;background:#0a0a0f;color:#f0f0f5;"><h2>Esta invitación ya fue respondida</h2></body></html>');
    const toPlayer = await Player.findById(inv.toPlayer);
    if (status === 'accepted' && (!toPlayer || !toPlayer.isComplete)) {
      res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Padel Match</title><style>
        *{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',-apple-system,sans-serif;background:#0a0a0f;color:#f0f0f5;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
        .card{background:#12121a;border-radius:20px;padding:32px 24px;max-width:400px;width:100%;border:1px solid rgba(255,255,255,0.06);text-align:center}
        .icon{font-size:48px;margin-bottom:16px}
        h2{font-size:1.3rem;margin-bottom:8px;font-weight:700}
        p{color:#6b6b80;font-size:0.9rem;margin-bottom:6px;line-height:1.5}
        .input-group{margin:16px 0;text-align:left}
        .input-group label{display:block;font-size:0.8rem;color:#6b6b80;margin-bottom:6px}
        .input-group input{width:100%;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,0.1);background:#1a1a2e;color:#f0f0f5;font-size:1rem;outline:none}
        .input-group input:focus{border-color:#25D366}
        .btn{display:inline-block;margin-top:16px;padding:14px 24px;border-radius:12px;text-decoration:none;font-weight:600;font-size:0.95rem;border:none;cursor:pointer;width:100%}
        .btn-green{background:#25D366;color:#000}
      </style></head><body>
        <div class="card">
          <div class="icon">🎾</div>
          <h2>¡Tenés una invitación!</h2>
          <p>${inv.fromName} te invitó a jugar al pádel.</p>
          ${inv.date ? `<p class="detail">📅 ${inv.date} ${inv.time ? `a las ${inv.time}` : ''}${inv.court ? ` · ${inv.court}` : ''}</p>` : ''}
          <p>Para aceptar, completá tus datos.</p>
<form id="regForm" onsubmit="event.preventDefault();submitReg()">
              <div class="input-group"><label>Nombre completo</label><input type="text" id="regName" required placeholder="Tu nombre" /></div>
              <div class="input-group" style="margin-top:12px;"><label>Contraseña</label><input type="password" id="regPassword" required placeholder="Mínimo 4 caracteres" /></div>
              <input type="hidden" id="invId" value="${req.params.id}" />
              <button type="submit" class="btn btn-green">Aceptar e ingreso</button>
            </form>
        </div>
        <script>async function submitReg(){const n=document.getElementById('regName').value.trim();const pw=document.getElementById('regPassword').value;if(!n)return;if(!pw||pw.length<4)return alert('La contraseña debe tener al menos 4 caracteres');const r=await fetch('/api/invitations/${req.params.id}/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n,password:pw})});if(r.ok){const d=await r.json();localStorage.setItem('padel_myId',d.playerId);location.href='/';}else{const err=await r.json();alert(err.error||'Error al registrarse')}}</script>
      </body></html>`);
      return;
    }
    const result = await db.respondInvitation(req.params.id, status);
    if (!result) return res.status(500).send('<html><body style="font-family:sans-serif;padding:40px;text-align:center;background:#0a0a0f;color:#f0f0f5;"><h2>Error al procesar</h2></body></html>');
    const invite = await db.getInvitationWithFrom(req.params.id);
    if (invite) {
      if (status === 'accepted') db.createMatchFromInvite(invite).catch(() => {});
      const toInfo = await db.getPlayer(inv.toPlayer.toString());
      const msgs = { accepted: 'aceptó tu invitación ✅', rejected: 'rechazó tu invitación ❌' };
      sendPushToPlayer(invite.fromPlayerId || inv.fromPlayer, `${toInfo ? toInfo.name : 'Un jugador'} ${msgs[status]}`, `${invite.date ? `📅 ${invite.date} ` : ''}${invite.court ? `📍 ${invite.court}` : ''}`.trim(), '/');
    }
    const base = `${req.protocol}://${req.get('host')}`;
    const isAccepted = status === 'accepted';
    const when = invite.date ? ` el ${invite.date}${invite.time ? ` a las ${invite.time}` : ''}${invite.court ? ` en ${invite.court}` : ''}` : '';
    const acceptMsg = `Hola ${invite.fromName}! Acepté tu invitación para jugar al pádel 🎾${when}. Coordinemos!`;
    const rejectMsg = `Hola ${invite.fromName}! No voy a poder asistir a tu invitación${when ? ` (${invite.date}${invite.time ? ` ${invite.time}` : ''})` : ''}. Disculpá.`;
    const waMsg = isAccepted ? acceptMsg : rejectMsg;
    res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Padel Match</title><style>
      *{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',-apple-system,sans-serif;background:#0a0a0f;color:#f0f0f5;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
      .card{background:#12121a;border-radius:20px;padding:32px 24px;max-width:400px;width:100%;border:1px solid rgba(255,255,255,0.06);text-align:center}
      .icon{font-size:48px;margin-bottom:16px}
      h2{font-size:1.3rem;margin-bottom:8px;font-weight:700}
      p{color:#6b6b80;font-size:0.9rem;margin-bottom:6px;line-height:1.5}
      .detail{color:#f0f0f5;font-weight:600}
      .btn{display:inline-block;margin-top:20px;padding:14px 24px;border-radius:12px;text-decoration:none;font-weight:600;font-size:0.95rem}
      .btn-green{background:#25D366;color:#000}
      .btn-red{background:#ff4757;color:#fff}
      .btn-outline{border:1px solid rgba(255,255,255,0.1);color:#6b6b80;margin-top:12px}
    </style></head><body>
      <div class="card">
        <div class="icon">${isAccepted ? '✅' : '❌'}</div>
        <h2>${isAccepted ? '¡Asistencia confirmada!' : 'Invitación rechazada'}</h2>
        <p>${isAccepted ? 'Has confirmado tu asistencia al partido con' : 'Has rechazado la invitación de'}</p>
        <p class="detail">${invite.fromName}</p>
        ${invite.date ? `<p style="font-size:0.85rem;color:#f0f0f5;margin-top:6px;">📅 ${invite.date} ${invite.time ? `a las ${invite.time}` : ''}${invite.court ? ` · ${invite.court}` : ''}</p>` : ''}
        <p style="font-size:0.8rem;color:#6b6b80;margin-top:14px;">Notificando al jugador...</p>
        <a class="btn ${isAccepted ? 'btn-green' : 'btn-red'}" href="https://wa.me/${invite.fromPhone}?text=${encodeURIComponent(waMsg)}" id="waBtn" target="_blank">${isAccepted ? 'Contactar por WhatsApp' : 'Enviar mensaje'}</a>
        <br>
        <a class="btn btn-outline" href="${base}" style="display:inline-block;margin-top:16px;">Ir a Padel Match</a>
      </div>
      <script>setTimeout(()=>{document.getElementById('waBtn').click()},1500)</script>
    </body></html>`);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/invitations/:id/register', async (req, res) => {
  try {
    const inv = await db.getInvitation(req.params.id);
    if (!inv || inv.status !== 'pending') return res.status(400).json({ error: 'Invitación no válida' });
    const { name, password } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nombre requerido' });
    if (!password) return res.status(400).json({ error: 'Contraseña requerida' });
    const player = await db.completeRegistration(inv.toPlayer, name.trim(), password);
    if (!player) return res.status(500).json({ error: 'Error al crear perfil' });
    await db.respondInvitation(req.params.id, 'accepted');
    const inv2 = await db.getInvitation(req.params.id);
    if (inv2 && inv2.fromPlayer) {
      if (inv2.status === 'accepted') db.createMatchFromInvite(inv2).catch(() => {});
      sendPushToPlayer(inv2.fromPlayer.toString(), `${name.trim()} aceptó tu invitación ✅`, `${inv2.date ? `📅 ${inv2.date} ` : ''}${inv2.court ? `📍 ${inv2.court}` : ''}`.trim(), '/');
    }
    res.json({ success: true, playerId: player.id });
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
    const invAfter = await Invitation.findById(req.params.id);
    if (invAfter && invAfter.fromPlayer && invAfter.toPlayer) {
      if (status === 'accepted') db.createMatchFromInvite(invAfter).catch(() => {});
      const responder = await db.getPlayer(invAfter.toPlayer.toString());
      const msgs = { accepted: 'aceptó tu invitación ✅', rejected: 'rechazó tu invitación ❌' };
      sendPushToPlayer(invAfter.fromPlayer.toString(), `${responder ? responder.name : 'Un jugador'} ${msgs[status]}`, `${invAfter.date ? `📅 ${invAfter.date} ` : ''}${invAfter.court ? `📍 ${invAfter.court}` : ''}`.trim(), '/');
    }
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

app.post('/api/rules/seed', async (req, res) => {
  try {
    await db.ensureRules();
    res.json({ ok: true, message: 'Reglas actualizadas' });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── ADMIN ──────────────────────────────────────────────

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'M@nza$23&08';
const adminTokens = new Set();
const SALT_ROUNDS = 10;

app.post('/api/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) return res.status(400).json({ error: 'Teléfono y contraseña son obligatorios' });
    const clean = phone.replace(/\s/g, '');
    const player = await Player.findOne({ phone: clean });
    if (!player) return res.status(401).json({ error: 'No existe cuenta con ese teléfono' });
    if (!player.isComplete) return res.status(403).json({ error: 'Cuenta incompleta' });
    const match = await bcrypt.compare(password, player.password);
    if (!match) return res.status(401).json({ error: 'Contraseña incorrecta' });
    res.json({ id: player._id.toString(), name: player.name, phone: player.phone, category: player.category, available: player.available });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  adminTokens.add(token);
  res.json({ token });
});

app.post('/api/admin/players', requireAdmin, async (req, res) => {
  try {
    const { phone, category } = req.body;
    if (!phone) return res.status(400).json({ error: 'Teléfono requerido' });
    if (!category) return res.status(400).json({ error: 'Categoría requerida' });
    const clean = phone.replace(/\s/g, '');
    const existing = await db.findPlayerByPhone(clean);
    if (existing) {
      if (existing.isComplete) return res.status(409).json({ error: 'Jugador completo ya existe' });
      return res.json({ ...existing, id: existing.id });
    }
    const player = await db.findOrCreatePendingPlayer(clean, category);
    res.status(201).json({ ...player, id: player.id });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ') || !adminTokens.has(auth.slice(7))) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

app.get('/api/admin/players', requireAdmin, async (req, res) => {
  try {
    res.json(await db.getAllPlayersFull());
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// Carga/actualiza claves VAPID (solo admin). Las guarda en Mongo para que
// el servidor (y los próximos deploys) las tomen sin necesitar env vars en Render.
app.put('/api/admin/vapid', requireAdmin, async (req, res) => {
  try {
    const { publicKey, privateKey, subject } = req.body;
    if (!publicKey || !privateKey) {
      return res.status(400).json({ error: 'publicKey y privateKey requeridos' });
    }
    try {
      applyVapid(publicKey, privateKey, subject);
    } catch (e) {
      return res.status(400).json({ error: 'Claves VAPID inválidas' });
    }
    await Config.findByIdAndUpdate('vapid', {
      value: { publicKey, privateKey, subject: subject || VAPID_SUBJECT }
    }, { upsert: true });
    res.json({ ok: true, enabled: pushReady, publicKey: vapidPublicKey });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.put('/api/admin/players/:id/suspend', requireAdmin, async (req, res) => {
  try {
    const { days } = req.body;
    const result = await db.adminSuspendPlayer(req.params.id, days || 30);
    if (!result) return res.status(404).json({ error: 'Jugador no encontrado' });
    sendPushToPlayer(req.params.id, `Estás suspendido por ${days || 30} días ⛔`, 'Incurriste en una falta según las reglas de Padel Match', '/');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.put('/api/admin/players/:id/unsuspend', requireAdmin, async (req, res) => {
  try {
    const result = await db.adminUnsuspendPlayer(req.params.id);
    if (!result) return res.status(404).json({ error: 'Jugador no encontrado' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.put('/api/admin/players/:id/warning', requireAdmin, async (req, res) => {
  try {
    const result = await db.adminAddWarning(req.params.id);
    if (!result) return res.status(404).json({ error: 'Jugador no encontrado' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.delete('/api/admin/players/:id', requireAdmin, async (req, res) => {
  try {
    const player = await db.getPlayer(req.params.id);
    if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });
    await db.deletePlayer(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.delete('/api/admin/invitations/:id', requireAdmin, async (req, res) => {
  try {
    await db.deleteInvitation(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.put('/api/admin/players/:id/reset-password', requireAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 4) return res.status(400).json({ error: 'Mínimo 4 caracteres' });
    const player = await db.getPlayer(req.params.id);
    if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(password, 10);
    await db.resetPlayerPassword(req.params.id, hash);
    res.json({ ok: true });
  } catch (err) {
    console.error('Reset password error:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.put('/api/admin/rules/:id', requireAdmin, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Contenido requerido' });
    const result = await db.updateRule(req.params.id, content);
    if (!result) return res.status(404).json({ error: 'Regla no encontrada' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    res.json(await db.getAdminStats());
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── CHAT & PUSH ───────────────────────────────────────

const msgLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados mensajes, intentá de nuevo en un momento' },
});

app.get('/api/push/public-key', async (req, res) => {
  await ensureVapid();
  res.json({ enabled: pushReady, publicKey: vapidPublicKey });
});

app.post('/api/push/subscribe', async (req, res) => {
  try {
    const { playerId, subscription } = req.body;
    if (!playerId || !subscription) return res.status(400).json({ error: 'playerId y subscription requeridos' });
    const player = await db.getPlayer(playerId);
    if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });
    if (!(await ensureVapid())) return res.status(503).json({ error: 'Notificaciones no configuradas' });
    await db.savePushSubscription(playerId, subscription);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/push/unsubscribe', async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription) return res.status(400).json({ error: 'subscription requerida' });
    await db.removePushSubscription(subscription.endpoint);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/conversations/:playerId', async (req, res) => {
  try {
    const convs = await db.getConversationsForPlayer(req.params.playerId);
    res.json(convs);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/conversations/with/:a/:b', async (req, res) => {
  try {
    const convo = await db.getOrCreateConversation(req.params.a, req.params.b);
    if (!convo) return res.status(404).json({ error: 'Conversación no disponible' });
    await db.markConversationRead(convo.id, req.params.a);
    res.json(convo);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/conversations/:id/messages', async (req, res) => {
  try {
    const messages = await db.getConversationMessages(req.params.id, req.query.since || null);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/conversations/:id/messages', msgLimiter, async (req, res) => {
  try {
    const { from, text } = req.body;
    if (!from || !text) return res.status(400).json({ error: 'from y text requeridos' });
    const msg = await db.sendMessage(req.params.id, from, text);
    if (!msg) return res.status(404).json({ error: 'Conversación no encontrada' });
    const conv = await mongoose.model('Conversation').findById(req.params.id);
    if (conv) {
      const isGroup = conv.type === 'group';
      const targets = conv.participants.filter(p => p.toString() !== from);
      const body = msg.text.length > 80 ? msg.text.slice(0, 80) + '…' : msg.text;
      if (isGroup) {
        for (const t of targets) {
          sendPushToPlayer(t.toString(), `[${conv.name || 'Grupo'}] ${msg.fromName}`, body, '/');
        }
      } else {
        const peerId = targets[0];
        if (peerId) sendPushToPlayer(peerId.toString(), `Nuevo mensaje de ${msg.fromName} 💬`, body, '/');
      }
    }
    res.status(201).json(msg);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/conversations/:id/read', async (req, res) => {
  try {
    const { playerId } = req.body;
    if (!playerId) return res.status(400).json({ error: 'playerId requerido' });
    const ok = await db.markConversationRead(req.params.id, playerId);
    if (!ok) return res.status(404).json({ error: 'Conversación no encontrada' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/conversations/groups', async (req, res) => {
  try {
    const { creatorId, name, memberIds } = req.body;
    if (!creatorId || !name) return res.status(400).json({ error: 'creatorId y name requeridos' });
    const result = await db.createGroupConversation(creatorId, name, memberIds || []);
    if (result.error) return res.status(400).json({ error: result.error });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.put('/api/players/:id/slots', async (req, res) => {
  try {
    const { slots } = req.body;
    if (!Array.isArray(slots)) return res.status(400).json({ error: 'slots debe ser un array' });
    const player = await db.setPlayerSlots(req.params.id, slots);
    if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });
    res.json({ ok: true, slots: player.slots || [] });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/players/:id/stats', async (req, res) => {
  try {
    res.json(await db.getPlayerStats(req.params.id));
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/matches/player/:id', async (req, res) => {
  try {
    res.json(await db.getMatchesForPlayer(req.params.id));
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/matches/:id/result', async (req, res) => {
  try {
    const { winnerTeam, score, by } = req.body;
    if (!by || !winnerTeam || !score) return res.status(400).json({ error: 'winnerTeam, score y by son requeridos' });
    const result = await db.registerMatchResult(req.params.id, winnerTeam, score, by);
    if (result.error) return res.status(400).json({ error: result.error });
    const match = result.match;
    const pids = match.players;
    const winnerPlayers = [];
    for (const pid of pids) {
      const p = await db.getPlayer(pid);
      if (p && p._id.toString() !== by) {
        const won = result.winners.some(w => w.toString() === pid.toString());
        winnerPlayers.push({ id: p._id.toString(), name: p.name, won });
      }
    }
    for (const wp of winnerPlayers) {
      sendPushToPlayer(wp.id, `${wp.won ? '🏆 Ganaste el partido!' : '📋 Resultado cargado'}`, `${match.score || ''}${match.court ? ` · ${match.court}` : ''}`, '/');
    }
    res.status(201).json({ match });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/app/summary/:playerId', async (req, res) => {
  try {
    const s = await db.buildAppSummary(req.params.playerId);
    if (!s) return res.status(404).json({ error: 'Jugador no encontrado' });
    res.json(s);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── SPA fallback ───────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── START ──────────────────────────────────────────────
async function connectMongo(retries = 5) {
  const uris = [];
  const mongoUri = buildMongoURI();
  if (mongoUri) uris.push(mongoUri);

  // Fallback: convertir SRV a directo si es necesario
  if (mongoUri && mongoUri.startsWith('mongodb+srv://')) {
    const direct = mongoUri.replace('mongodb+srv://', 'mongodb://')
      .replace(/\.mongodb\.net\/(.*?)(\?|$)/, '.mongodb.net:27017/padel-match?ssl=true&authSource=admin');
    if (direct !== mongoUri) uris.push(direct);
  }

  for (const uri of uris) {
    for (let i = 1; i <= retries; i++) {
      try {
        console.log(`Conectando MongoDB (${i}/${retries})...`);
        await mongoose.connect(uri, MONGODB_OPTIONS);
        console.log('Conectado a MongoDB');
        await db.ensureRules();
        console.log('Reglas inicializadas');
        ensureVapid().catch(() => {});
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

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'No encontrado' });
});

async function start() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor HTTP corriendo en puerto ${PORT}`);
  });
  connectMongo();
}

start();
