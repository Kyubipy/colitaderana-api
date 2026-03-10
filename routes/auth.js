const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { generateToken, verifyToken } = require('../middleware/auth');

// POST /api/auth/register - Registrar nuevo usuario
router.post('/register', async (req, res) => {
  try {
    const { email, password, nombre, apellido, telefono } = req.body;

    // Validaciones
    if (!email || !password || !nombre || !apellido) {
      return res.status(400).json({ error: 'Campos requeridos: email, password, nombre, apellido' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    // Verificar si el email ya existe
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Ya existe una cuenta con este correo' });
    }

    // Hash de la contraseña
    const hashedPassword = await bcrypt.hash(password, 10);
    const uid = uuidv4();

    // Insertar usuario
    const result = await pool.query(
      `INSERT INTO users (uid, email, password, nombre, apellido, telefono)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING uid, email, nombre, apellido, telefono, role, created_at`,
      [uid, email.toLowerCase(), hashedPassword, nombre, apellido, telefono || null]
    );

    const user = result.rows[0];
    const token = generateToken(user);

    res.status(201).json({
      message: 'Usuario registrado exitosamente',
      user: {
        uid: user.uid,
        email: user.email,
        nombre: user.nombre,
        apellido: user.apellido,
        telefono: user.telefono,
        role: user.role
      },
      token
    });

  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

// POST /api/auth/login - Iniciar sesión (busca en users Y doctors)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    // Primero buscar en tabla users
    const userResult = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND is_active = true',
      [email.toLowerCase()]
    );

    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ error: 'Credenciales inválidas' });
      }

      const token = generateToken(user);
      return res.json({
        message: 'Login exitoso',
        user: {
          uid: user.uid,
          email: user.email,
          nombre: user.nombre,
          apellido: user.apellido,
          telefono: user.telefono,
          photoUrl: user.photo_url,
          role: user.role
        },
        token
      });
    }

    // Si no está en users, buscar en doctors
    const doctorResult = await pool.query(
      'SELECT * FROM doctors WHERE email = $1 AND is_active = true',
      [email.toLowerCase()]
    );

    if (doctorResult.rows.length > 0) {
      const doctor = doctorResult.rows[0];
      const validPassword = await bcrypt.compare(password, doctor.password);
      if (!validPassword) {
        return res.status(401).json({ error: 'Credenciales inválidas' });
      }

      const token = generateToken({ ...doctor, role: 'doctor' });
      return res.json({
        message: 'Login exitoso',
        user: {
          uid: doctor.uid,
          email: doctor.email,
          nombre: doctor.nombre,
          apellido: doctor.apellido,
          telefono: doctor.telefono,
          photoUrl: doctor.photo_url,
          role: 'doctor'
        },
        token
      });
    }

    return res.status(401).json({ error: 'Credenciales inválidas' });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// POST /api/auth/login/doctor - Login para doctores
router.post('/login/doctor', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    const result = await pool.query(
      'SELECT * FROM doctors WHERE email = $1 AND is_active = true',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const doctor = result.rows[0];

    const validPassword = await bcrypt.compare(password, doctor.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = generateToken({ ...doctor, role: 'doctor' });

    res.json({
      message: 'Login exitoso',
      doctor: {
        uid: doctor.uid,
        email: doctor.email,
        nombre: doctor.nombre,
        apellido: doctor.apellido,
        especialidad: doctor.especialidad,
        photoUrl: doctor.photo_url,
        role: 'doctor'
      },
      token
    });

  } catch (error) {
    console.error('Error en login doctor:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// GET /api/auth/me - Obtener usuario actual
router.get('/me', verifyToken, async (req, res) => {
  try {
    res.json({ user: req.user });
  } catch (error) {
    res.status(500).json({ error: 'Error obteniendo usuario' });
  }
});

// PUT /api/auth/fcm-token - Actualizar token de FCM para push notifications
router.put('/fcm-token', verifyToken, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    const { uid, role } = req.user;

    const table = role === 'doctor' ? 'doctors' : 'users';
    
    await pool.query(
      `UPDATE ${table} SET fcm_token = $1, updated_at = CURRENT_TIMESTAMP WHERE uid = $2`,
      [fcmToken, uid]
    );

    res.json({ message: 'Token actualizado' });
  } catch (error) {
    res.status(500).json({ error: 'Error actualizando token' });
  }
});

// POST /api/auth/forgot-password - Solicitar reset de contraseña
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    // En producción aquí enviarías un email con link de reset
    // Por ahora solo verificamos que existe
    const result = await pool.query(
      'SELECT uid FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    // Siempre responder igual para no revelar si el email existe
    res.json({ message: 'Si el email existe, recibirás instrucciones para restablecer tu contraseña' });

  } catch (error) {
    res.status(500).json({ error: 'Error procesando solicitud' });
  }
});

// POST /api/auth/admin/reset-password - Reset temporal (QUITAR EN PRODUCCIÓN)
router.post('/admin/reset-password', async (req, res) => {
  try {
    const { email, newPassword, table } = req.body;

    if (!email || !newPassword) {
      return res.status(400).json({ error: 'email y newPassword requeridos' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const targetTable = table === 'doctors' ? 'doctors' : 'users';

    const result = await pool.query(
      `UPDATE ${targetTable} SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE email = $2 RETURNING email, nombre, apellido`,
      [hashedPassword, email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({ message: 'Contraseña reseteada', user: result.rows[0] });
  } catch (error) {
    console.error('Error reseteando contraseña:', error);
    res.status(500).json({ error: 'Error reseteando contraseña' });
  }
});

module.exports = router;
