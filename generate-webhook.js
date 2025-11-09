const crypto = require('crypto');
const { URLSearchParams } = require('url'); 

// 🚨 CLAVE SECRETA PROPORCIONADA POR EL USUARIO 🚨
const PLISIO_SECRET_KEY = 'ffu-VfsL3WDet7YNDsjkVUMt4EflfeOolYj-ZvTcgHm1F1dbKiX76zjV93RRFmKK'; 

// --- 1. Parámetros que simulan una respuesta 'completed' de Plisio ---
const params = {
    amount: '1.00', // Monto simulado
    currency: 'USD',
    // Datos de ejemplo para el correo de confirmación
    data: '{"customer_email":"test.malok.webhook@example.com","product_id":"test_product"}', 
    expire_at: '1766467200',
    // Un número de orden de prueba único. Si esta orden existe en Supabase y está 'pending', se actualizará.
    order_number: 'ORD-WEBHOOK-TEST-001', 
    psys_cid: 'USDT_TRC20', 
    status: 'completed', // ESTADO CRUCIAL para disparar el procesamiento
    txn_id: 'TEST-TXN-SIMULADO-9876'
};

// --- Lógica para Generar la Firma (SHA1) ---
const sortedKeys = Object.keys(params).sort();

let signatureString = '';
for (const key of sortedKeys) {
    signatureString += params[key];
}
signatureString += PLISIO_SECRET_KEY;

// Calcular el SHA1 hash
const calculatedSecret = crypto.createHash('sha1').update(signatureString).digest('hex');

// 2. Adjuntar la firma y formatear el cuerpo de la petición
params.secret = calculatedSecret;

// Formatear el cuerpo de la petición para cURL/Postman
const postBody = new URLSearchParams(params).toString();

console.log(`\n--- RESULTADOS DE LA PRUEBA SIMULADA ---`);
console.log(`Paso 3: Copia el siguiente texto COMPLETO (el BODY) para usarlo en el comando cURL.`);
console.log(`\nBODY (x-www-form-urlencoded):\n${postBody}`);