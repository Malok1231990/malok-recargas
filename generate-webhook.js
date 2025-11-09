const crypto = require('crypto');
const { URLSearchParams } = require('url'); 

// 🚨 1. REEMPLAZA ESTO con tu CLAVE SECRETA REAL de Plisio
const PLISIO_API_KEY = 'TU_CLAVE_SECRETA_DE_PLISIO'; 

// 🚨 2. REEMPLAZA con el 'id_transaccion' REAL de Supabase (ID de Plisio)
const realPlisioTxnId = 'ID_PLISIO_DE_SUPABASE'; 

// 🚨 3. REEMPLAZA con el 'order_number' TEMPORAL de Supabase (MALOK-timestamp)
const temporalOrderNumber = 'MALOK-timestamp'; 

// Parámetros que Plisio enviaría al Webhook
const params = {
    amount: '1.03', // El monto que se usó en la prueba de $1.00 + 3% de comisión
    currency: 'USD',
    data: 'TEST_DATA', 
    expire_at: '1766467200',
    order_number: temporalOrderNumber,
    psys_cid: 'USDT_TRC20', 
    status: 'completed', 
    txn_id: realPlisioTxnId,
    api_key: PLISIO_API_KEY // La API Key se usa para generar la firma
};

// --- Lógica de Hash MD5 (Como está en plisio-webhook.js) ---
const keys = Object.keys(params)
    .filter(key => key !== 'verify_hash' && key !== 'api_key')
    .sort();

let hashString = '';
keys.forEach(key => {
    // Usamos el valor directamente de los params
    hashString += params[key]; 
});
hashString += PLISIO_API_KEY; 

const calculatedHash = crypto.createHash('md5').update(hashString).digest('hex');

// El cuerpo que se envía al webhook
const postBodyParams = { ...params, verify_hash: calculatedHash };
delete postBodyParams.api_key; // La API Key no se envía en el cuerpo

const postBody = new URLSearchParams(postBodyParams).toString();

console.log(`\n--- COPIA EL SIGUIENTE COMANDO EN POWERSHELL ---\n`);
console.log(`$BodyData = '${postBody}'; Invoke-WebRequest -Uri 'https://malok-recargas.netlify.app/.netlify/functions/plisio-webhook?json=true' -Method POST -Body $BodyData -ContentType 'application/x-www-form-urlencoded'`);