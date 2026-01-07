const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'pediguardia_secret_key_2024';

// Middleware para verificar token
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }

    const token = authHeader.split(' ')[1];
    
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Verificar si el usuario existe
    const result = await pool.query(
      'SELECT uid, email, nombre, apellido, role FROM users WHERE uid = $1 AND is_active = true',
      [decoded.uid]
    );

    if (result.rows.length === 0) {
      // Verificar si es doctor
      const doctorResult = await pool.query(
        'SELECT uid, email, nombre, apellido FROM doctors WHERE uid = $1 AND is_active = true',
        [decoded.uid]
      );
      
      if (doctorResult.rows.length === 0) {
        return res.status(401).json({ error: 'Usuario no encontrado' });
      }
      
      req.user = { ...doctorResult.rows[0], role: 'doctor' };
    } else {
      req.user = result.rows[0];
    }

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Token inválido' });
    }
    console.error('Error en auth middleware:', error);
    res.status(500).json({ error: 'Error de autenticación' });
  }
};

// Middleware para verificar si es doctor
const verifyDoctor = async (req, res, next) => {
  try {
    if (req.user.role !== 'doctor') {
      return res.status(403).json({ error: 'Acceso solo para doctores' });
    }
    next();
  } catch (error) {
    res.status(500).json({ error: 'Error verificando rol' });
  }
};

// Generar token
const generateToken = (user) => {
  return jwt.sign(
    { 
      uid: user.uid, 
      email: user.email,
      role: user.role || 'paciente'
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
};

module.exports = { verifyToken, verifyDoctor, generateToken, JWT_SECRET };
