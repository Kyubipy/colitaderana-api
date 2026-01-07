const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { verifyToken, verifyDoctor } = require('../middleware/auth');

// GET /api/doctors - Obtener todos los doctores activos
router.get('/', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT uid, nombre, apellido, especialidad, subespecialidad, 
              bio, rating, consultas_realizadas, is_online, disponible_24h,
              precio_chat, precio_video, photo_url
       FROM doctors 
       WHERE is_active = true
       ORDER BY is_online DESC, rating DESC`
    );

    const doctors = result.rows.map(doc => ({
      ...doc,
      nombreCompleto: `Dr(a). ${doc.nombre} ${doc.apellido}`
    }));

    res.json({ doctors });
  } catch (error) {
    console.error('Error obteniendo doctores:', error);
    res.status(500).json({ error: 'Error obteniendo doctores' });
  }
});

// GET /api/doctors/online - Obtener doctores en línea
router.get('/online', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT uid, nombre, apellido, especialidad, subespecialidad, 
              bio, rating, consultas_realizadas, precio_chat, precio_video, photo_url
       FROM doctors 
       WHERE is_active = true AND is_online = true
       ORDER BY rating DESC`
    );

    const doctors = result.rows.map(doc => ({
      ...doc,
      nombreCompleto: `Dr(a). ${doc.nombre} ${doc.apellido}`
    }));

    res.json({ doctors });
  } catch (error) {
    console.error('Error obteniendo doctores online:', error);
    res.status(500).json({ error: 'Error obteniendo doctores' });
  }
});

// GET /api/doctors/:uid - Obtener un doctor específico
router.get('/:uid', verifyToken, async (req, res) => {
  try {
    const { uid } = req.params;

    const result = await pool.query(
      `SELECT uid, nombre, apellido, especialidad, subespecialidad, matricula,
              bio, rating, consultas_realizadas, is_online, disponible_24h,
              precio_chat, precio_video, photo_url
       FROM doctors 
       WHERE uid = $1 AND is_active = true`,
      [uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Doctor no encontrado' });
    }

    const doctor = result.rows[0];
    res.json({ 
      doctor: {
        ...doctor,
        nombreCompleto: `Dr(a). ${doctor.nombre} ${doctor.apellido}`
      }
    });
  } catch (error) {
    console.error('Error obteniendo doctor:', error);
    res.status(500).json({ error: 'Error obteniendo doctor' });
  }
});

// PUT /api/doctors/online-status - Actualizar estado online (solo doctores)
router.put('/online-status', verifyToken, verifyDoctor, async (req, res) => {
  try {
    const { uid } = req.user;
    const { isOnline } = req.body;

    await pool.query(
      'UPDATE doctors SET is_online = $1, updated_at = CURRENT_TIMESTAMP WHERE uid = $2',
      [isOnline, uid]
    );

    res.json({ message: 'Estado actualizado', isOnline });
  } catch (error) {
    console.error('Error actualizando estado:', error);
    res.status(500).json({ error: 'Error actualizando estado' });
  }
});

// POST /api/doctors/create - Crear doctor (solo admin o para setup inicial)
router.post('/create', async (req, res) => {
  try {
    const { 
      email, password, nombre, apellido, telefono,
      especialidad, subespecialidad, matricula, bio,
      precioChat, precioVideo 
    } = req.body;

    // Validaciones
    if (!email || !password || !nombre || !apellido || !especialidad || !matricula) {
      return res.status(400).json({ 
        error: 'Campos requeridos: email, password, nombre, apellido, especialidad, matricula' 
      });
    }

    // Verificar si existe
    const existing = await pool.query(
      'SELECT id FROM doctors WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Ya existe un doctor con este email' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const uid = uuidv4();

    const result = await pool.query(
      `INSERT INTO doctors (
        uid, email, password, nombre, apellido, telefono,
        especialidad, subespecialidad, matricula, bio,
        precio_chat, precio_video
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING uid, email, nombre, apellido, especialidad`,
      [
        uid, email.toLowerCase(), hashedPassword, nombre, apellido, telefono || null,
        especialidad, subespecialidad || null, matricula, bio || null,
        precioChat || 70000, precioVideo || 120000
      ]
    );

    res.status(201).json({
      message: 'Doctor creado exitosamente',
      doctor: result.rows[0]
    });
  } catch (error) {
    console.error('Error creando doctor:', error);
    res.status(500).json({ error: 'Error creando doctor' });
  }
});

// GET /api/doctors/me/profile - Perfil del doctor logueado
router.get('/me/profile', verifyToken, verifyDoctor, async (req, res) => {
  try {
    const { uid } = req.user;

    const result = await pool.query(
      `SELECT uid, email, nombre, apellido, telefono, especialidad, subespecialidad,
              matricula, bio, rating, consultas_realizadas, is_online, disponible_24h,
              precio_chat, precio_video, photo_url, created_at
       FROM doctors WHERE uid = $1`,
      [uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Doctor no encontrado' });
    }

    res.json({ doctor: result.rows[0] });
  } catch (error) {
    console.error('Error obteniendo perfil doctor:', error);
    res.status(500).json({ error: 'Error obteniendo perfil' });
  }
});

// GET /api/doctors/me/stats - Estadísticas del doctor
router.get('/me/stats', verifyToken, verifyDoctor, async (req, res) => {
  try {
    const { uid } = req.user;

    const consultationsResult = await pool.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status IN ('pagado', 'en_curso') THEN 1 END) as activas,
        COUNT(CASE WHEN status = 'finalizado' THEN 1 END) as finalizadas,
        COALESCE(SUM(CASE WHEN status = 'finalizado' THEN precio ELSE 0 END), 0) as ingresos
       FROM consultations WHERE doctor_uid = $1`,
      [uid]
    );

    const stats = consultationsResult.rows[0];

    res.json({
      stats: {
        consultasTotal: parseInt(stats.total),
        consultasActivas: parseInt(stats.activas),
        consultasFinalizadas: parseInt(stats.finalizadas),
        ingresosTotales: parseInt(stats.ingresos)
      }
    });
  } catch (error) {
    console.error('Error obteniendo stats doctor:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
});

module.exports = router;
