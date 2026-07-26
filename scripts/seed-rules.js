const mongoose = require('mongoose');
const Rule = require('../models/Rule');

const RULES = [
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

async function seed() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/padel-match';
  const user = process.env.MONGO_USER;
  const pass = process.env.MONGO_PASS;
  const hosts = process.env.MONGO_HOSTS;
  const db = process.env.MONGO_DB || 'padel-match';

  let mongoUri = uri;
  if (!mongoUri && user && pass && hosts) {
    mongoUri = `mongodb://${user}:${pass}@${hosts}/${db}?ssl=true&replicaSet=atlas-11uadz-shard-0&authSource=admin`;
  }

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000
  });

  await Rule.deleteMany({});
  await Rule.insertMany(RULES.map((content, i) => ({ content, order: i + 1 })));
  console.log(`Insertadas ${RULES.length} reglas`);
  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
