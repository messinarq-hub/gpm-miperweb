// Servidor de registro y trazabilidad de controles — MIPER Nave 4/4
// Conecta la app estática (GitHub Pages) con una base de datos Postgres en Neon.
// No guarda contraseñas en texto plano: se hashean con bcrypt antes de guardarlas.

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

if (!JWT_SECRET || !DATABASE_URL) {
  console.error('Faltan variables de entorno JWT_SECRET y/o DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Crea las tablas automáticamente si todavía no existen — así no hay que pegar
// ningún script SQL a mano en Neon: alcanza con crear el proyecto y copiar la
// clave de conexión.
async function initSchema(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id            SERIAL PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS controles_log (
      id            SERIAL PRIMARY KEY,
      username      TEXT NOT NULL,
      cat_id        TEXT NOT NULL,
      cat_label     TEXT NOT NULL,
      task_idx      INTEGER NOT NULL,
      tarea         TEXT NOT NULL,
      riesgo_idx    INTEGER NOT NULL,
      riesgo        TEXT NOT NULL,
      factor_idx    INTEGER,
      factor        TEXT,
      estado        TEXT NOT NULL CHECK (estado IN ('no_aplica', 'cumple', 'no_cumple')),
      checked_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_controles_task ON controles_log (cat_id, task_idx);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_controles_control_cell ON controles_log (cat_id, task_idx, riesgo_idx, checked_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_controles_username ON controles_log (username);`);
  console.log('Esquema verificado/creado correctamente.');
}

function normalizeUsername(u) {
  return (u || '').toString().trim().toLowerCase().slice(0, 60);
}

function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: '90d' });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sesión inválida o vencida. Vuelva a ingresar.' });
  }
}

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'miper-server' });
});

// ---------- AUTH ----------

app.post('/auth/registro', async (req, res) => {
  try {
    const username = normalizeUsername(req.body.username);
    const password = (req.body.password || '').toString();

    if (!username) return res.status(400).json({ error: 'Falta el nombre de usuario.' });
    if (!/^\d{4}$/.test(password)) return res.status(400).json({ error: 'La clave debe ser un código de 4 dígitos.' });

    const existing = await pool.query('SELECT id FROM usuarios WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Ese usuario ya existe.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO usuarios (username, password_hash) VALUES ($1, $2) RETURNING id, username',
      [username, hash]
    );
    const user = result.rows[0];
    return res.status(201).json({ token: signToken(user), username: user.username });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error del servidor al registrar el usuario.' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const username = normalizeUsername(req.body.username);
    const password = (req.body.password || '').toString();

    const result = await pool.query('SELECT id, username, password_hash FROM usuarios WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario o clave incorrectos.' });
    }
    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Usuario o clave incorrectos.' });
    }
    return res.json({ token: signToken(user), username: user.username });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error del servidor al iniciar sesión.' });
  }
});

// ---------- CONTROLES ----------

// Registra una marca de control (No aplica / Cumple / No cumple).
// Queda como fila nueva en el historial: nunca se sobrescribe, para mantener trazabilidad completa.
app.post('/controles', requireAuth, async (req, res) => {
  try {
    const {
      catId, catLabel, taskIdx, tarea,
      riesgoIdx, riesgo, factorIdx, factor, estado,
    } = req.body;

    if (!['no_aplica', 'cumple', 'no_cumple'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido.' });
    }

    const result = await pool.query(
      `INSERT INTO controles_log
        (username, cat_id, cat_label, task_idx, tarea, riesgo_idx, riesgo, factor_idx, factor, estado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, checked_at`,
      [req.user.username, catId, catLabel, taskIdx, tarea, riesgoIdx, riesgo, factorIdx, factor || null, estado]
    );
    return res.status(201).json({ ok: true, id: result.rows[0].id, checked_at: result.rows[0].checked_at });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error del servidor al guardar el control.' });
  }
});

// Devuelve el estado registrado HOY (hora de Chile) de cada control (riesgo+factor)
// para una tarea, para poder pre-marcar las casillas al abrir la tarea.
// El historial completo (de todos los días) queda guardado en controles_log de todas
// formas — esto solo filtra qué se muestra ya marcado en el formulario, para que cada
// jornada empiece "en blanco" sin perder ningún registro anterior.
app.get('/controles/tarea', requireAuth, async (req, res) => {
  try {
    const catId = req.query.catId;
    const taskIdx = parseInt(req.query.taskIdx, 10);
    if (!catId || Number.isNaN(taskIdx)) {
      return res.status(400).json({ error: 'Faltan parámetros catId/taskIdx.' });
    }
    const result = await pool.query(
      `SELECT DISTINCT ON (riesgo_idx)
         riesgo_idx, factor_idx, estado, username, checked_at
       FROM controles_log
       WHERE cat_id = $1 AND task_idx = $2
         AND checked_at >= (date_trunc('day', now() AT TIME ZONE 'America/Santiago') AT TIME ZONE 'America/Santiago')
       ORDER BY riesgo_idx, checked_at DESC`,
      [catId, taskIdx]
    );
    return res.json({ items: result.rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error del servidor al leer los controles.' });
  }
});

// Formatea una fecha en hora de Chile (America/Santiago), para que el CSV de
// auditoría y cualquier lectura manual sean legibles sin tener que restar
// horas mentalmente desde UTC.
function toChileString(date) {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(date).replace(',', '');
}

// Exporta todo el historial como CSV, para trazabilidad / auditoría.
app.get('/controles/export.csv', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT username, cat_label, tarea, riesgo, factor, estado, checked_at
       FROM controles_log
       ORDER BY checked_at DESC`
    );
    const header = 'usuario,categoria,tarea,riesgo,factor,estado,fecha_chile\n';
    const rows = result.rows.map(r => [
      r.username, r.cat_label, r.tarea, r.riesgo, r.factor || '', r.estado, toChileString(r.checked_at),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="miper_controles.csv"');
    return res.send(header + rows);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error del servidor al exportar.' });
  }
});

// Devuelve estadísticas agregadas de cumplimiento, para el dashboard general.
app.get('/controles/dashboard', requireAuth, async (req, res) => {
  try {
    const totales = await pool.query(
      `SELECT estado, COUNT(*)::int AS total
       FROM controles_log
       GROUP BY estado`
    );
    const porCategoria = await pool.query(
      `SELECT cat_label,
              COUNT(*) FILTER (WHERE estado = 'cumple')::int AS cumple,
              COUNT(*) FILTER (WHERE estado = 'no_cumple')::int AS no_cumple,
              COUNT(*) FILTER (WHERE estado = 'no_aplica')::int AS no_aplica,
              COUNT(*)::int AS total
       FROM controles_log
       GROUP BY cat_label
       ORDER BY total DESC`
    );
    const porUsuario = await pool.query(
      `SELECT username,
              COUNT(*) FILTER (WHERE estado = 'cumple')::int AS cumple,
              COUNT(*) FILTER (WHERE estado = 'no_cumple')::int AS no_cumple,
              COUNT(*)::int AS total,
              MAX(checked_at) AS ultima_marca
       FROM controles_log
       GROUP BY username
       ORDER BY total DESC`
    );
    return res.json({
      totales: totales.rows,
      porCategoria: porCategoria.rows,
      porUsuario: porUsuario.rows,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error del servidor al calcular el dashboard.' });
  }
});

const PORT = process.env.PORT || 3000;
initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`miper-server escuchando en puerto ${PORT}`);
    });
  })
  .catch(err => {
    console.error('No se pudo preparar la base de datos:', err);
    process.exit(1);
  });
