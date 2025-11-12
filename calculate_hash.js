// calculate_hash.js
const crypto = require('crypto');

// ⚠️ TU CLAVE SECRETA (No se repite en la conversación)
const PLISIO_API_KEY = "ffu-VfsL3WDet7YNDsjkVUMt4EflfeOolYj-ZvTcgHm1F1dbKiX76zjV93RRFmKK"; 

// EL PAYLOAD EXACTO que se enviará en el webhook
const payload = {
    order_number: "MALOK-1762947961440",
    status: "completed",
    txn_id: "PLISIO_TEST_TXN_002",
    amount: "0.0031",
    currency: "BTC",
    source_amount: "206.00",
    source_currency: "USD",
    psys_cid: 1
};

// 1. Convertir el payload a una cadena JSON ordenada alfabéticamente
// Este paso es crucial para la firma HMAC de Plisio.
const sortedKeys = Object.keys(payload).sort();
let jsonString = '{';
for (let i = 0; i < sortedKeys.length; i++) {
    const key = sortedKeys[i];
    jsonString += `"${key}":"${payload[key]}"`;
    if (i < sortedKeys.length - 1) {
        jsonString += ',';
    }
}
jsonString += '}';

// 2. Calcular el HMAC-SHA1
const hmac = crypto.createHmac('sha1', PLISIO_API_KEY);
hmac.update(jsonString);
const calculatedHash = hmac.digest('hex');

console.log("JSON String Firmado (Node.js):", jsonString);
console.log("\n✅ Hash Calculado (Node.js):", calculatedHash);