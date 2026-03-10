const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { verifyToken, verifyDoctor } = require('../middleware/auth');

// GET /api/consultations - Obtener consultas del usuario
router.get('/', verifyToken, async (req, res) => {
  try {
    const { uid, role } = req.user;
    const { status } = req.query;

    let query = `
      SELECT c.*, 
             p.nombre as patient_nombre, p.apellido as patient_apellido,
             d.nombre as doctor_nombre, d.apellido as doctor_apellido,
             d.especialidad as doctor_especialidad, d.photo_url as doctor_photo
      FROM consultations c
      JOIN patients p ON c.patient_uid = p.uid
      JOIN doctors d ON c.doctor_uid = d.uid
    `;

    const params = [];
    
    if (role === 'doctor') {
      query += ' WHERE c.doctor_uid = $1';
      params.push(uid);
    } else {
      query += ' WHERE c.parent_uid = $1';
      params.push(uid);
    }

    if (status) {
      params.push(status);
      query += ` AND c.status = $${params.length}`;
    }

    query += ' ORDER BY c.created_at DESC';

    const result = await pool.query(query, params);

    const consultations = result.rows.map(c => ({
      uid: c.uid,
      tipo: c.tipo,
      status: c.status,
      motivoConsulta: c.motivo_consulta,
      sintomas: c.sintomas,
      diagnostico: c.diagnostico,
      indicaciones: c.indicaciones,
      precio: c.precio,
      pagado: c.pagado,
      createdAt: c.created_at,
      startedAt: c.started_at,
      endedAt: c.ended_at,
      patient: {
        uid: c.patient_uid,
        nombre: c.patient_nombre,
        apellido: c.patient_apellido,
        nombreCompleto: `${c.patient_nombre} ${c.patient_apellido}`
      },
      doctor: {
        uid: c.doctor_uid,
        nombre: c.doctor_nombre,
        apellido: c.doctor_apellido,
        nombreCompleto: `Dr(a). ${c.doctor_nombre} ${c.doctor_apellido}`,
        especialidad: c.doctor_especialidad,
        photoUrl: c.doctor_photo
      }
    }));

    res.json({ consultations });
  } catch (error) {
    console.error('Error obteniendo consultas:', error);
    res.status(500).json({ error: 'Error obteniendo consultas' });
  }
});

// GET /api/consultations/active - Consultas activas
router.get('/active', verifyToken, async (req, res) => {
  try {
    const { uid, role } = req.user;

    let query = `
      SELECT c.*, 
             p.nombre as patient_nombre, p.apellido as patient_apellido,
             d.nombre as doctor_nombre, d.apellido as doctor_apellido
      FROM consultations c
      JOIN patients p ON c.patient_uid = p.uid
      JOIN doctors d ON c.doctor_uid = d.uid
      WHERE c.status IN ('pagado', 'en_curso')
    `;

    if (role === 'doctor') {
      query += ' AND c.doctor_uid = $1';
    } else {
      query += ' AND c.parent_uid = $1';
    }

    query += ' ORDER BY c.created_at DESC';

    const result = await pool.query(query, [uid]);

    res.json({ consultations: result.rows });
  } catch (error) {
    console.error('Error obteniendo consultas activas:', error);
    res.status(500).json({ error: 'Error obteniendo consultas' });
  }
});

// GET /api/consultations/:uid - Obtener una consulta específica
router.get('/:uid', verifyToken, async (req, res) => {
  try {
    const { uid: userUid, role } = req.user;
    const { uid } = req.params;

    const result = await pool.query(
      `SELECT c.*, 
              p.nombre as patient_nombre, p.apellido as patient_apellido,
              p.fecha_nacimiento, p.sexo, p.alergias, p.enfermedades_cronicas,
              d.nombre as doctor_nombre, d.apellido as doctor_apellido,
              d.especialidad, d.photo_url as doctor_photo
       FROM consultations c
       JOIN patients p ON c.patient_uid = p.uid
       JOIN doctors d ON c.doctor_uid = d.uid
       WHERE c.uid = $1`,
      [uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Consulta no encontrada' });
    }

    const c = result.rows[0];

    // Verificar acceso
    if (role !== 'doctor' && c.parent_uid !== userUid) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    if (role === 'doctor' && c.doctor_uid !== userUid) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    res.json({ consultation: c });
  } catch (error) {
    console.error('Error obteniendo consulta:', error);
    res.status(500).json({ error: 'Error obteniendo consulta' });
  }
});

// POST /api/consultations - Crear nueva consulta
router.post('/', verifyToken, async (req, res) => {
  try {
    const { uid: parentUid } = req.user;
    const { patientUid, doctorUid, tipo, motivoConsulta, sintomas } = req.body;

    // Validaciones
    if (!patientUid || !doctorUid || !tipo || !motivoConsulta) {
      return res.status(400).json({ 
        error: 'Campos requeridos: patientUid, doctorUid, tipo, motivoConsulta' 
      });
    }

    if (!['chat', 'video'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo debe ser "chat" o "video"' });
    }

    // Verificar que el paciente pertenece al usuario
    const patientCheck = await pool.query(
      'SELECT uid FROM patients WHERE uid = $1 AND parent_uid = $2',
      [patientUid, parentUid]
    );

    if (patientCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Paciente no válido' });
    }

    // Obtener precio del doctor
    const doctorResult = await pool.query(
      'SELECT precio_chat, precio_video FROM doctors WHERE uid = $1 AND is_active = true',
      [doctorUid]
    );

    if (doctorResult.rows.length === 0) {
      return res.status(400).json({ error: 'Doctor no disponible' });
    }

    const precio = tipo === 'chat' 
      ? doctorResult.rows[0].precio_chat 
      : doctorResult.rows[0].precio_video;

    const uid = uuidv4();

    const result = await pool.query(
      `INSERT INTO consultations (
        uid, parent_uid, patient_uid, doctor_uid, tipo, 
        motivo_consulta, sintomas, precio, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pendiente')
      RETURNING *`,
      [uid, parentUid, patientUid, doctorUid, tipo, motivoConsulta, sintomas || null, precio]
    );

    res.status(201).json({
      message: 'Consulta creada exitosamente',
      consultation: result.rows[0]
    });
  } catch (error) {
    console.error('Error creando consulta:', error);
    res.status(500).json({ error: 'Error creando consulta' });
  }
});

// PUT /api/consultations/:uid/status - Actualizar estado de consulta
router.put('/:uid/status', verifyToken, async (req, res) => {
  try {
    const { uid } = req.params;
    const { status } = req.body;
    const { uid: userUid, role } = req.user;

    const validStatuses = ['pendiente', 'pagado', 'en_curso', 'finalizado', 'cancelado'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Estado no válido' });
    }

    // Verificar propiedad
    const check = await pool.query(
      'SELECT parent_uid, doctor_uid FROM consultations WHERE uid = $1',
      [uid]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Consulta no encontrada' });
    }

    const consultation = check.rows[0];
    
    // Solo el padre puede cancelar, solo el doctor puede finalizar
    if (status === 'cancelado' && role !== 'doctor' && consultation.parent_uid !== userUid) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    let updateQuery = 'UPDATE consultations SET status = $1, updated_at = CURRENT_TIMESTAMP';
    const params = [status, uid];

    if (status === 'en_curso') {
      updateQuery += ', started_at = CURRENT_TIMESTAMP';
    } else if (status === 'finalizado') {
      updateQuery += ', ended_at = CURRENT_TIMESTAMP';
    }

    updateQuery += ' WHERE uid = $2 RETURNING *';

    const result = await pool.query(updateQuery, params);

    // Si se finaliza, incrementar contador del doctor
    if (status === 'finalizado') {
      await pool.query(
        'UPDATE doctors SET consultas_realizadas = consultas_realizadas + 1 WHERE uid = $1',
        [consultation.doctor_uid]
      );
    }

    res.json({
      message: 'Estado actualizado',
      consultation: result.rows[0]
    });
  } catch (error) {
    console.error('Error actualizando estado:', error);
    res.status(500).json({ error: 'Error actualizando estado' });
  }
});

// PUT /api/consultations/:uid/diagnosis - Agregar diagnóstico (solo doctor)
router.put('/:uid/diagnosis', verifyToken, verifyDoctor, async (req, res) => {
  try {
    const { uid } = req.params;
    const { diagnostico, indicaciones, recetaUrl } = req.body;
    const { uid: doctorUid } = req.user;

    // Verificar que la consulta es del doctor
    const check = await pool.query(
      'SELECT doctor_uid FROM consultations WHERE uid = $1',
      [uid]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Consulta no encontrada' });
    }

    if (check.rows[0].doctor_uid !== doctorUid) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const result = await pool.query(
      `UPDATE consultations SET 
        diagnostico = $1, 
        indicaciones = $2, 
        receta_url = $3,
        updated_at = CURRENT_TIMESTAMP
       WHERE uid = $4
       RETURNING *`,
      [diagnostico, indicaciones, recetaUrl, uid]
    );

    res.json({
      message: 'Diagnóstico guardado',
      consultation: result.rows[0]
    });
  } catch (error) {
    console.error('Error guardando diagnóstico:', error);
    res.status(500).json({ error: 'Error guardando diagnóstico' });
  }
});

// GET /api/consultations/:uid/video-session - Obtener sesión de video
router.get('/:uid/video-session', verifyToken, async (req, res) => {
  try {
    const { uid: userUid, role } = req.user;
    const { uid } = req.params;

    const result = await pool.query(
      `SELECT c.*,
              d.nombre as doctor_nombre, d.apellido as doctor_apellido,
              p.nombre as patient_nombre, p.apellido as patient_apellido
       FROM consultations c
       JOIN doctors d ON c.doctor_uid = d.uid
       JOIN patients p ON c.patient_uid = p.uid
       WHERE c.uid = $1`,
      [uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Consulta no encontrada' });
    }

    const consultation = result.rows[0];

    // Verificar acceso
    if (role !== 'doctor' && consultation.parent_uid !== userUid) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    if (role === 'doctor' && consultation.doctor_uid !== userUid) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    // Generar nombre de sala único
    const roomName = `colitaderana-${uid}`;

    // Nombre para mostrar según rol
    const displayName = role === 'doctor'
      ? `Dr(a). ${consultation.doctor_nombre} ${consultation.doctor_apellido}`
      : `${consultation.patient_nombre} ${consultation.patient_apellido} (Padre/Madre)`;

    res.json({
      videoSession: {
        roomName,
        serverUrl: 'https://meet.jit.si',
        fullUrl: `https://meet.jit.si/${roomName}`,
        displayName,
        consultationUid: uid,
        tipo: consultation.tipo,
        status: consultation.status,
        doctor: `Dr(a). ${consultation.doctor_nombre} ${consultation.doctor_apellido}`,
        patient: `${consultation.patient_nombre} ${consultation.patient_apellido}`
      }
    });
  } catch (error) {
    console.error('Error generando sesión de video:', error);
    res.status(500).json({ error: 'Error generando sesión de video' });
  }
});

module.exports = router;
