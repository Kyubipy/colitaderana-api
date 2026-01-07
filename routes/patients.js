const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { verifyToken } = require('../middleware/auth');

// GET /api/patients - Obtener pacientes del usuario
router.get('/', verifyToken, async (req, res) => {
  try {
    const { uid } = req.user;

    const result = await pool.query(
      `SELECT uid, nombre, apellido, fecha_nacimiento, sexo, grupo_sanguineo,
              alergias, enfermedades_cronicas, peso, talla, photo_url, created_at
       FROM patients 
       WHERE parent_uid = $1
       ORDER BY created_at DESC`,
      [uid]
    );

    // Calcular edad para cada paciente
    const patients = result.rows.map(patient => ({
      ...patient,
      edad: calculateAge(patient.fecha_nacimiento),
      esRecienNacido: isNewborn(patient.fecha_nacimiento),
      nombreCompleto: `${patient.nombre} ${patient.apellido}`
    }));

    res.json({ patients });
  } catch (error) {
    console.error('Error obteniendo pacientes:', error);
    res.status(500).json({ error: 'Error obteniendo pacientes' });
  }
});

// GET /api/patients/:uid - Obtener un paciente específico
router.get('/:uid', verifyToken, async (req, res) => {
  try {
    const { uid: parentUid } = req.user;
    const { uid } = req.params;

    const result = await pool.query(
      `SELECT * FROM patients WHERE uid = $1 AND parent_uid = $2`,
      [uid, parentUid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Paciente no encontrado' });
    }

    const patient = result.rows[0];
    res.json({ 
      patient: {
        ...patient,
        edad: calculateAge(patient.fecha_nacimiento),
        esRecienNacido: isNewborn(patient.fecha_nacimiento),
        nombreCompleto: `${patient.nombre} ${patient.apellido}`
      }
    });
  } catch (error) {
    console.error('Error obteniendo paciente:', error);
    res.status(500).json({ error: 'Error obteniendo paciente' });
  }
});

// POST /api/patients - Crear nuevo paciente
router.post('/', verifyToken, async (req, res) => {
  try {
    const { uid: parentUid } = req.user;
    const { 
      nombre, apellido, fechaNacimiento, sexo, 
      grupoSanguineo, alergias, enfermedadesCronicas, peso, talla 
    } = req.body;

    // Validaciones
    if (!nombre || !apellido || !fechaNacimiento || !sexo) {
      return res.status(400).json({ 
        error: 'Campos requeridos: nombre, apellido, fechaNacimiento, sexo' 
      });
    }

    const uid = uuidv4();

    const result = await pool.query(
      `INSERT INTO patients (
        uid, parent_uid, nombre, apellido, fecha_nacimiento, sexo,
        grupo_sanguineo, alergias, enfermedades_cronicas, peso, talla
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        uid, parentUid, nombre, apellido, fechaNacimiento, sexo,
        grupoSanguineo || null,
        alergias || [],
        enfermedadesCronicas || [],
        peso || null,
        talla || null
      ]
    );

    const patient = result.rows[0];

    res.status(201).json({
      message: 'Paciente creado exitosamente',
      patient: {
        ...patient,
        edad: calculateAge(patient.fecha_nacimiento),
        nombreCompleto: `${patient.nombre} ${patient.apellido}`
      }
    });
  } catch (error) {
    console.error('Error creando paciente:', error);
    res.status(500).json({ error: 'Error creando paciente' });
  }
});

// PUT /api/patients/:uid - Actualizar paciente
router.put('/:uid', verifyToken, async (req, res) => {
  try {
    const { uid: parentUid } = req.user;
    const { uid } = req.params;
    const { 
      nombre, apellido, fechaNacimiento, sexo, 
      grupoSanguineo, alergias, enfermedadesCronicas, peso, talla, photoUrl 
    } = req.body;

    // Verificar que el paciente pertenece al usuario
    const checkResult = await pool.query(
      'SELECT uid FROM patients WHERE uid = $1 AND parent_uid = $2',
      [uid, parentUid]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Paciente no encontrado' });
    }

    const result = await pool.query(
      `UPDATE patients SET
        nombre = COALESCE($1, nombre),
        apellido = COALESCE($2, apellido),
        fecha_nacimiento = COALESCE($3, fecha_nacimiento),
        sexo = COALESCE($4, sexo),
        grupo_sanguineo = COALESCE($5, grupo_sanguineo),
        alergias = COALESCE($6, alergias),
        enfermedades_cronicas = COALESCE($7, enfermedades_cronicas),
        peso = COALESCE($8, peso),
        talla = COALESCE($9, talla),
        photo_url = COALESCE($10, photo_url),
        updated_at = CURRENT_TIMESTAMP
       WHERE uid = $11 AND parent_uid = $12
       RETURNING *`,
      [nombre, apellido, fechaNacimiento, sexo, grupoSanguineo, 
       alergias, enfermedadesCronicas, peso, talla, photoUrl, uid, parentUid]
    );

    const patient = result.rows[0];

    res.json({
      message: 'Paciente actualizado',
      patient: {
        ...patient,
        edad: calculateAge(patient.fecha_nacimiento),
        nombreCompleto: `${patient.nombre} ${patient.apellido}`
      }
    });
  } catch (error) {
    console.error('Error actualizando paciente:', error);
    res.status(500).json({ error: 'Error actualizando paciente' });
  }
});

// DELETE /api/patients/:uid - Eliminar paciente
router.delete('/:uid', verifyToken, async (req, res) => {
  try {
    const { uid: parentUid } = req.user;
    const { uid } = req.params;

    const result = await pool.query(
      'DELETE FROM patients WHERE uid = $1 AND parent_uid = $2 RETURNING uid',
      [uid, parentUid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Paciente no encontrado' });
    }

    res.json({ message: 'Paciente eliminado' });
  } catch (error) {
    console.error('Error eliminando paciente:', error);
    res.status(500).json({ error: 'Error eliminando paciente' });
  }
});

// Funciones auxiliares
function calculateAge(fechaNacimiento) {
  const birth = new Date(fechaNacimiento);
  const today = new Date();
  const diffDays = Math.floor((today - birth) / (1000 * 60 * 60 * 24));
  
  if (diffDays < 30) {
    return `${diffDays} días`;
  } else if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `${months} ${months === 1 ? 'mes' : 'meses'}`;
  } else {
    const years = Math.floor(diffDays / 365);
    const remainingMonths = Math.floor((diffDays % 365) / 30);
    if (remainingMonths > 0) {
      return `${years} ${years === 1 ? 'año' : 'años'} y ${remainingMonths} ${remainingMonths === 1 ? 'mes' : 'meses'}`;
    }
    return `${years} ${years === 1 ? 'año' : 'años'}`;
  }
}

function isNewborn(fechaNacimiento) {
  const birth = new Date(fechaNacimiento);
  const today = new Date();
  const diffDays = Math.floor((today - birth) / (1000 * 60 * 60 * 24));
  return diffDays <= 28;
}

module.exports = router;
