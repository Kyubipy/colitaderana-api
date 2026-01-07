const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { verifyToken } = require('../middleware/auth');

// GET /api/users/profile - Obtener perfil del usuario
router.get('/profile', verifyToken, async (req, res) => {
  try {
    const { uid } = req.user;

    const result = await pool.query(
      `SELECT uid, email, nombre, apellido, telefono, photo_url, role, created_at
       FROM users WHERE uid = $1`,
      [uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Error obteniendo perfil:', error);
    res.status(500).json({ error: 'Error obteniendo perfil' });
  }
});

// PUT /api/users/profile - Actualizar perfil
router.put('/profile', verifyToken, async (req, res) => {
  try {
    const { uid } = req.user;
    const { nombre, apellido, telefono, photoUrl } = req.body;

    const result = await pool.query(
      `UPDATE users 
       SET nombre = COALESCE($1, nombre),
           apellido = COALESCE($2, apellido),
           telefono = COALESCE($3, telefono),
           photo_url = COALESCE($4, photo_url),
           updated_at = CURRENT_TIMESTAMP
       WHERE uid = $5
       RETURNING uid, email, nombre, apellido, telefono, photo_url, role`,
      [nombre, apellido, telefono, photoUrl, uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({ 
      message: 'Perfil actualizado',
      user: result.rows[0] 
    });
  } catch (error) {
    console.error('Error actualizando perfil:', error);
    res.status(500).json({ error: 'Error actualizando perfil' });
  }
});

// PUT /api/users/password - Cambiar contraseña
router.put('/password', verifyToken, async (req, res) => {
  try {
    const { uid } = req.user;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Contraseña actual y nueva requeridas' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    }

    // Verificar contraseña actual
    const userResult = await pool.query(
      'SELECT password FROM users WHERE uid = $1',
      [uid]
    );

    const bcrypt = require('bcryptjs');
    const validPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    }

    // Hash de nueva contraseña
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query(
      'UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE uid = $2',
      [hashedPassword, uid]
    );

    res.json({ message: 'Contraseña actualizada exitosamente' });
  } catch (error) {
    console.error('Error cambiando contraseña:', error);
    res.status(500).json({ error: 'Error cambiando contraseña' });
  }
});

// GET /api/users/stats - Obtener estadísticas del usuario
router.get('/stats', verifyToken, async (req, res) => {
  try {
    const { uid } = req.user;

    // Contar pacientes
    const patientsResult = await pool.query(
      'SELECT COUNT(*) as total FROM patients WHERE parent_uid = $1',
      [uid]
    );

    // Contar consultas
    const consultationsResult = await pool.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status IN ('pagado', 'en_curso') THEN 1 END) as activas,
        COUNT(CASE WHEN status = 'finalizado' THEN 1 END) as finalizadas
       FROM consultations WHERE parent_uid = $1`,
      [uid]
    );

    res.json({
      stats: {
        pacientes: parseInt(patientsResult.rows[0].total),
        consultasTotal: parseInt(consultationsResult.rows[0].total),
        consultasActivas: parseInt(consultationsResult.rows[0].activas),
        consultasFinalizadas: parseInt(consultationsResult.rows[0].finalizadas)
      }
    });
  } catch (error) {
    console.error('Error obteniendo stats:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
});

module.exports = router;
