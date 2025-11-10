const crypto = require('crypto');
const { URLSearchParams } = require('url'); 

// 🚨 1. REEMPLAZA ESTO con tu CLAVE SECRETA REAL de Plisio
const PLISIO_API_KEY = 'ffu-VfsL3WDet7YNDsjkVUMt4EflfeOolYj-ZvTcgHm1F1dbKiX76zjV93RRFmKK'; 

// 🚨 2. REEMPLAZA con el 'id_transaccion' REAL de Supabase (ID de Plisio)
const realPlisioTxnId = '6910f70962dca4e78c0d3352'; // <--- EJEMPLO: USA TU VALOR REAL

// 🚨 3. REEMPLAZA con el 'order_number' TEMPORAL de Supabase (MALOK-timestamp)
const temporalOrderNumber = 'MALOK-1731174984252'; // <--- EJEMPLO: USA TU VALOR REAL

// Parámetros que Plisio enviaría al Webhook
const params = {
    amount: '1.03', // Monto de la prueba
    currency: 'USD',
    data: 'TEST_DATA', 
    expire_at: '1766467200',
    order_number: temporalOrderNumber,
    psys_cid: 'USDT_TRC20', 
    status: 'completed', 
    txn_id: realPlisioTxnId,
    api_key: PLISIO_API_KEY 
};

// --- CÁLCULO DEL HASH MD5 (Tu lógica de Webhook) ---
const keys = Object.keys(params)
    .filter(key => key !== 'verify_hash' && key !== 'api_key')
    .sort();

let hashString = '';
keys.forEach(key => {
    hashString += params[key]; 
});
hashString += PLISIO_API_KEY; 

const calculatedHash = crypto.createHash('md5').update(hashString).digest('hex');

// Prepara el cuerpo del POST
const postBodyParams = { ...params, verify_hash: calculatedHash };
delete postBodyParams.api_key; 

const postBody = new URLSearchParams(postBodyParams).toString();

console.log(`\n--- COPIA Y EJECUTA ESTE COMANDO EN POWERSHELL ---\n`);
console.log(`$BodyData = '${postBody}'; Invoke-WebRequest -Uri 'https://malok-recargas.netlify.app/.netlify/functions/plisio-webhook?json=true' -Method POST -Body $BodyData -ContentType 'application/x-www-form-urlencoded'`);