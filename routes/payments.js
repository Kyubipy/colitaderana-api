const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { verifyToken } = require('../middleware/auth');

// Configuración de Pagopar (agregar tus credenciales)
const PAGOPAR_CONFIG = {
  publicKey: process.env.PAGOPAR_PUBLIC_KEY,
  privateKey: process.env.PAGOPAR_PRIVATE_KEY,
  apiUrl: process.env.PAGOPAR_API_URL || 'https://api.pagopar.com'
};

// POST /api/payments/create - Crear intento de pago
router.post('/create', verifyToken, async (req, res) => {
  try {
    const { uid: userUid } = req.user;
    const { consultationUid } = req.body;

    if (!consultationUid) {
      return res.status(400).json({ error: 'consultationUid requerido' });
    }

    // Obtener consulta
    const consultationResult = await pool.query(
      'SELECT uid, parent_uid, precio, status, pagado FROM consultations WHERE uid = $1',
      [consultationUid]
    );

    if (consultationResult.rows.length === 0) {
      return res.status(404).json({ error: 'Consulta no encontrada' });
    }

    const consultation = consultationResult.rows[0];

    if (consultation.parent_uid !== userUid) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    if (consultation.pagado) {
      return res.status(400).json({ error: 'La consulta ya está pagada' });
    }

    const paymentUid = uuidv4();

    // Crear registro de pago pendiente
    const paymentResult = await pool.query(
      `INSERT INTO payments (uid, consultation_uid, user_uid, amount, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING *`,
      [paymentUid, consultationUid, userUid, consultation.precio]
    );

    // TODO: Integrar con Pagopar API real
    // Por ahora simulamos la respuesta
    const pagoparResponse = {
      id: `pagopar_${paymentUid}`,
      checkout_url: `https://checkout.pagopar.com/pay/${paymentUid}`,
      amount: consultation.precio,
      currency: 'PYG'
    };

    // Actualizar con ID de Pagopar
    await pool.query(
      'UPDATE payments SET provider_payment_id = $1, provider_response = $2 WHERE uid = $3',
      [pagoparResponse.id, JSON.stringify(pagoparResponse), paymentUid]
    );

    res.json({
      payment: {
        uid: paymentUid,
        amount: consultation.precio,
        currency: 'PYG',
        checkoutUrl: pagoparResponse.checkout_url
      }
    });
  } catch (error) {
    console.error('Error creando pago:', error);
    res.status(500).json({ error: 'Error creando pago' });
  }
});

// POST /api/payments/webhook - Webhook de Pagopar
router.post('/webhook', async (req, res) => {
  try {
    const { payment_id, status, transaction_id } = req.body;

    console.log('Webhook recibido:', req.body);

    // Buscar pago por provider_payment_id
    const paymentResult = await pool.query(
      'SELECT uid, consultation_uid, status FROM payments WHERE provider_payment_id = $1',
      [payment_id]
    );

    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }

    const payment = paymentResult.rows[0];

    // Actualizar estado del pago
    const newStatus = status === 'completed' ? 'completed' : 
                      status === 'failed' ? 'failed' : 'pending';

    await pool.query(
      `UPDATE payments SET status = $1, provider_response = $2, updated_at = CURRENT_TIMESTAMP 
       WHERE uid = $3`,
      [newStatus, JSON.stringify(req.body), payment.uid]
    );

    // Si el pago fue exitoso, actualizar la consulta
    if (newStatus === 'completed') {
      await pool.query(
        `UPDATE consultations SET pagado = true, status = 'pagado', payment_id = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE uid = $2`,
        [payment.uid, payment.consultation_uid]
      );
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Error procesando webhook:', error);
    res.status(500).json({ error: 'Error procesando webhook' });
  }
});

// POST /api/payments/simulate - Simular pago exitoso (solo para desarrollo)
router.post('/simulate', verifyToken, async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'No disponible en producción' });
    }

    const { consultationUid } = req.body;
    const { uid: userUid } = req.user;

    // Verificar consulta
    const consultationResult = await pool.query(
      'SELECT uid, parent_uid, precio FROM consultations WHERE uid = $1 AND parent_uid = $2',
      [consultationUid, userUid]
    );

    if (consultationResult.rows.length === 0) {
      return res.status(404).json({ error: 'Consulta no encontrada' });
    }

    const paymentUid = uuidv4();

    // Crear pago completado
    await pool.query(
      `INSERT INTO payments (uid, consultation_uid, user_uid, amount, status, payment_method)
       VALUES ($1, $2, $3, $4, 'completed', 'simulated')`,
      [paymentUid, consultationUid, userUid, consultationResult.rows[0].precio]
    );

    // Actualizar consulta
    await pool.query(
      `UPDATE consultations SET pagado = true, status = 'pagado', payment_id = $1 WHERE uid = $2`,
      [paymentUid, consultationUid]
    );

    res.json({ 
      message: 'Pago simulado exitosamente',
      paymentUid,
      consultationStatus: 'pagado'
    });
  } catch (error) {
    console.error('Error simulando pago:', error);
    res.status(500).json({ error: 'Error simulando pago' });
  }
});

// GET /api/payments/history - Historial de pagos del usuario
router.get('/history', verifyToken, async (req, res) => {
  try {
    const { uid: userUid } = req.user;

    const result = await pool.query(
      `SELECT p.*, c.tipo as consultation_tipo, c.motivo_consulta
       FROM payments p
       JOIN consultations c ON p.consultation_uid = c.uid
       WHERE p.user_uid = $1
       ORDER BY p.created_at DESC`,
      [userUid]
    );

    res.json({ payments: result.rows });
  } catch (error) {
    console.error('Error obteniendo historial:', error);
    res.status(500).json({ error: 'Error obteniendo historial' });
  }
});

// GET /api/payments/:uid - Obtener detalle de un pago
router.get('/:uid', verifyToken, async (req, res) => {
  try {
    const { uid } = req.params;
    const { uid: userUid } = req.user;

    const result = await pool.query(
      `SELECT p.*, c.tipo, c.motivo_consulta, c.status as consultation_status
       FROM payments p
       JOIN consultations c ON p.consultation_uid = c.uid
       WHERE p.uid = $1 AND p.user_uid = $2`,
      [uid, userUid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }

    res.json({ payment: result.rows[0] });
  } catch (error) {
    console.error('Error obteniendo pago:', error);
    res.status(500).json({ error: 'Error obteniendo pago' });
  }
});

module.exports = router;
