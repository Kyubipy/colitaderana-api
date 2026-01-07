const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { verifyToken } = require('../middleware/auth');

// GET /api/messages/:consultationUid - Obtener mensajes de una consulta
router.get('/:consultationUid', verifyToken, async (req, res) => {
  try {
    const { consultationUid } = req.params;
    const { uid: userUid, role } = req.user;
    const { limit = 50, before } = req.query;

    // Verificar acceso a la consulta
    const consultationCheck = await pool.query(
      'SELECT parent_uid, doctor_uid FROM consultations WHERE uid = $1',
      [consultationUid]
    );

    if (consultationCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Consulta no encontrada' });
    }

    const consultation = consultationCheck.rows[0];
    
    if (role !== 'doctor' && consultation.parent_uid !== userUid) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    if (role === 'doctor' && consultation.doctor_uid !== userUid) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    let query = `
      SELECT uid, sender_uid, sender_type, sender_name, type, content, 
             media_url, is_read, created_at
      FROM messages 
      WHERE consultation_uid = $1
    `;
    const params = [consultationUid];

    if (before) {
      params.push(before);
      query += ` AND created_at < $${params.length}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const result = await pool.query(query, params);

    // Revertir para tener orden cronológico
    const messages = result.rows.reverse();

    res.json({ messages });
  } catch (error) {
    console.error('Error obteniendo mensajes:', error);
    res.status(500).json({ error: 'Error obteniendo mensajes' });
  }
});

// POST /api/messages - Enviar mensaje
router.post('/', verifyToken, async (req, res) => {
  try {
    const { uid: userUid, role, nombre, apellido } = req.user;
    const { consultationUid, content, type = 'text', mediaUrl } = req.body;

    if (!consultationUid || !content) {
      return res.status(400).json({ error: 'consultationUid y content son requeridos' });
    }

    // Verificar acceso y que la consulta esté activa
    const consultationCheck = await pool.query(
      'SELECT parent_uid, doctor_uid, status FROM consultations WHERE uid = $1',
      [consultationUid]
    );

    if (consultationCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Consulta no encontrada' });
    }

    const consultation = consultationCheck.rows[0];

    // Verificar que puede enviar mensajes
    if (role !== 'doctor' && consultation.parent_uid !== userUid) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    if (role === 'doctor' && consultation.doctor_uid !== userUid) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    // Verificar que la consulta esté activa
    if (!['pagado', 'en_curso'].includes(consultation.status)) {
      return res.status(400).json({ error: 'La consulta no está activa' });
    }

    const messageUid = uuidv4();
    const senderType = role === 'doctor' ? 'doctor' : 'user';
    const senderName = `${nombre} ${apellido}`;

    const result = await pool.query(
      `INSERT INTO messages (uid, consultation_uid, sender_uid, sender_type, sender_name, type, content, media_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [messageUid, consultationUid, userUid, senderType, senderName, type, content, mediaUrl || null]
    );

    // Si es el primer mensaje, actualizar consulta a "en_curso"
    if (consultation.status === 'pagado') {
      await pool.query(
        'UPDATE consultations SET status = $1, started_at = CURRENT_TIMESTAMP WHERE uid = $2',
        ['en_curso', consultationUid]
      );
    }

    res.status(201).json({
      message: 'Mensaje enviado',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error enviando mensaje:', error);
    res.status(500).json({ error: 'Error enviando mensaje' });
  }
});

// PUT /api/messages/read/:consultationUid - Marcar mensajes como leídos
router.put('/read/:consultationUid', verifyToken, async (req, res) => {
  try {
    const { consultationUid } = req.params;
    const { uid: userUid, role } = req.user;

    // El usuario marca como leídos los mensajes que NO son suyos
    const senderType = role === 'doctor' ? 'user' : 'doctor';

    await pool.query(
      `UPDATE messages 
       SET is_read = true 
       WHERE consultation_uid = $1 AND sender_type = $2 AND is_read = false`,
      [consultationUid, senderType]
    );

    res.json({ message: 'Mensajes marcados como leídos' });
  } catch (error) {
    console.error('Error marcando mensajes:', error);
    res.status(500).json({ error: 'Error actualizando mensajes' });
  }
});

// GET /api/messages/unread/count - Contar mensajes no leídos
router.get('/unread/count', verifyToken, async (req, res) => {
  try {
    const { uid: userUid, role } = req.user;

    // Buscar mensajes no leídos en consultas activas del usuario
    const senderType = role === 'doctor' ? 'user' : 'doctor';
    const userField = role === 'doctor' ? 'doctor_uid' : 'parent_uid';

    const result = await pool.query(
      `SELECT COUNT(*) as count
       FROM messages m
       JOIN consultations c ON m.consultation_uid = c.uid
       WHERE c.${userField} = $1 
         AND m.sender_type = $2 
         AND m.is_read = false
         AND c.status IN ('pagado', 'en_curso')`,
      [userUid, senderType]
    );

    res.json({ unreadCount: parseInt(result.rows[0].count) });
  } catch (error) {
    console.error('Error contando mensajes:', error);
    res.status(500).json({ error: 'Error contando mensajes' });
  }
});

// POST /api/messages/system - Enviar mensaje del sistema
router.post('/system', verifyToken, async (req, res) => {
  try {
    const { consultationUid, content } = req.body;

    const messageUid = uuidv4();

    const result = await pool.query(
      `INSERT INTO messages (uid, consultation_uid, sender_uid, sender_type, sender_name, type, content)
       VALUES ($1, $2, 'system', 'system', 'Sistema', 'system', $3)
       RETURNING *`,
      [messageUid, consultationUid, content]
    );

    res.status(201).json({ message: result.rows[0] });
  } catch (error) {
    console.error('Error enviando mensaje sistema:', error);
    res.status(500).json({ error: 'Error enviando mensaje' });
  }
});

module.exports = router;
