require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const initDB = async () => {
  try {
    console.log('🚀 Iniciando creación de tablas...\n');

    // Tabla de usuarios (padres/tutores)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        uid VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        nombre VARCHAR(100) NOT NULL,
        apellido VARCHAR(100) NOT NULL,
        telefono VARCHAR(20),
        photo_url TEXT,
        role VARCHAR(20) DEFAULT 'paciente',
        fcm_token TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Tabla users creada');

    // Tabla de doctores
    await pool.query(`
      CREATE TABLE IF NOT EXISTS doctors (
        id SERIAL PRIMARY KEY,
        uid VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        nombre VARCHAR(100) NOT NULL,
        apellido VARCHAR(100) NOT NULL,
        telefono VARCHAR(20),
        photo_url TEXT,
        especialidad VARCHAR(100) NOT NULL,
        subespecialidad VARCHAR(100),
        matricula VARCHAR(50) NOT NULL,
        bio TEXT,
        rating DECIMAL(2,1) DEFAULT 5.0,
        consultas_realizadas INTEGER DEFAULT 0,
        is_online BOOLEAN DEFAULT false,
        disponible_24h BOOLEAN DEFAULT true,
        precio_chat INTEGER DEFAULT 70000,
        precio_video INTEGER DEFAULT 120000,
        fcm_token TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Tabla doctors creada');

    // Tabla de pacientes (hijos)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS patients (
        id SERIAL PRIMARY KEY,
        uid VARCHAR(100) UNIQUE NOT NULL,
        parent_uid VARCHAR(100) NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
        nombre VARCHAR(100) NOT NULL,
        apellido VARCHAR(100) NOT NULL,
        fecha_nacimiento DATE NOT NULL,
        sexo VARCHAR(20) NOT NULL,
        grupo_sanguineo VARCHAR(10),
        alergias TEXT[],
        enfermedades_cronicas TEXT[],
        peso DECIMAL(5,2),
        talla DECIMAL(5,2),
        photo_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Tabla patients creada');

    // Tabla de consultas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS consultations (
        id SERIAL PRIMARY KEY,
        uid VARCHAR(100) UNIQUE NOT NULL,
        parent_uid VARCHAR(100) NOT NULL REFERENCES users(uid),
        patient_uid VARCHAR(100) NOT NULL REFERENCES patients(uid),
        doctor_uid VARCHAR(100) NOT NULL REFERENCES doctors(uid),
        tipo VARCHAR(20) NOT NULL, -- 'chat' o 'video'
        status VARCHAR(20) DEFAULT 'pendiente', -- pendiente, pagado, en_curso, finalizado, cancelado
        motivo_consulta TEXT NOT NULL,
        sintomas TEXT,
        diagnostico TEXT,
        indicaciones TEXT,
        receta_url TEXT,
        precio INTEGER NOT NULL,
        pagado BOOLEAN DEFAULT false,
        payment_id VARCHAR(100),
        started_at TIMESTAMP,
        ended_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Tabla consultations creada');

    // Tabla de mensajes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        uid VARCHAR(100) UNIQUE NOT NULL,
        consultation_uid VARCHAR(100) NOT NULL REFERENCES consultations(uid) ON DELETE CASCADE,
        sender_uid VARCHAR(100) NOT NULL,
        sender_type VARCHAR(20) NOT NULL, -- 'user' o 'doctor'
        sender_name VARCHAR(200),
        type VARCHAR(20) DEFAULT 'text', -- text, image, audio, file, system
        content TEXT NOT NULL,
        media_url TEXT,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Tabla messages creada');

    // Tabla de pagos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        uid VARCHAR(100) UNIQUE NOT NULL,
        consultation_uid VARCHAR(100) NOT NULL REFERENCES consultations(uid),
        user_uid VARCHAR(100) NOT NULL REFERENCES users(uid),
        amount INTEGER NOT NULL,
        currency VARCHAR(10) DEFAULT 'PYG',
        status VARCHAR(20) DEFAULT 'pending', -- pending, completed, failed, refunded
        payment_method VARCHAR(50),
        payment_provider VARCHAR(50) DEFAULT 'pagopar',
        provider_payment_id VARCHAR(100),
        provider_response JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Tabla payments creada');

    // Tabla de notificaciones
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        uid VARCHAR(100) UNIQUE NOT NULL,
        user_uid VARCHAR(100),
        doctor_uid VARCHAR(100),
        title VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        type VARCHAR(50),
        data JSONB,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Tabla notifications creada');

    // Índices para mejor performance
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_patients_parent ON patients(parent_uid)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_consultations_parent ON consultations(parent_uid)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_consultations_doctor ON consultations(doctor_uid)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_consultation ON messages(consultation_uid)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_payments_consultation ON payments(consultation_uid)`);
    console.log('✅ Índices creados');

    console.log('\n🎉 Base de datos inicializada correctamente!');
    
  } catch (error) {
    console.error('❌ Error inicializando DB:', error.message);
  } finally {
    await pool.end();
  }
};

initDB();
