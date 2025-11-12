const crypto = require('crypto');

// 🔑 TU CLAVE SECRETA DE PLISIO
const PLISIO_WEBHOOK_SECRET = "ffu-VfsL3WDet7YNDsjkVUMt4EflfeOolYj-ZvTcgHm1F1dbKiX76zjV93RRFmKK";

// 💰 JSON CANÓNICO (ORDEN ALFABÉTICO) para MALOK-1762950986718
const payloadData = {
    amount: "206", // finalPrice (con comisión)
    currency: "USDT_TRX", 
    order_number: "MALOK-1762950986718",
    psys_cid: 1, // CRÍTICO: Debe ser un número (1) para coincidir con tu webhook
    source_amount: "200.00", // base_amount
    source_currency: "USD",
    status: "completed",
    txn_id: "69147f4b46e0f45b7601b015" // methodDetails.plisio_txn_id
};

// ... (El código de Node.js para ordenar, stringify y calcular el hash es el mismo)
// ...

// Plisio espera el JSON stringificado, ordenado alfabéticamente y SIN espacios.
// Para el hashing, se usa solo la data SIN el verify_hash.
const sortedKeys = Object.keys(payloadData).sort();
let hashString = '{';
for (let i = 0; i < sortedKeys.length; i++) {
    const key = sortedKeys[i];
    const value = payloadData[key];
    hashString += `"${key}":${(typeof value === 'string' ? `"${value}"` : value)}${i < sortedKeys.length - 1 ? ',' : ''}`;
}
hashString += '}';

// Concatenar JSON sin espacios + Clave Secreta
const stringToHash = hashString + PLISIO_WEBHOOK_SECRET;

// Calcular SHA1 Hash
const calculatedHash = crypto.createHash('sha1').update(stringToHash).digest('hex');

console.log(`JSON String Firmado (Node.js): ${hashString}`);
console.log(`\n✅ Hash Calculado (Node.js): ${calculatedHash}`);