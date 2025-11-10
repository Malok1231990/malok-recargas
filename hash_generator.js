const crypto = require('crypto');

// 🔑 CLAVE REAL PROPORCIONADA POR EL USUARIO
const PLISIO_API_KEY = 'ffu-VfsL3WDet7YNDsjkVUMt4EflfeOolYj-ZvTcgHm1F1dbKiX76zjV93RRFmKK'; 

// 2. VALORES FIJOS DE LA TRANSACCIÓN (ORDENADOS ALFABÉTICAMENTE)
// Estos son los campos que tu función de Netlify (plisio-webhook.js) usa.
const values = [
    "10.5781", // amount
    "10.5781", // amount_in
    "USD",     // currency_in
    "USD",     // currency_out
    "completed", // status
    "MALOK-1762799988175" // txn_id
];

// 3. Cadena de Hash: Concatena los valores y la PLISIO_API_KEY
const hashString = values.join('') + PLISIO_API_KEY;

// 4. Generar el Hash SHA1 (EL ALGORITMO ESPERADO POR NETLIFY)
const expectedSecret = crypto.createHash('sha1').update(hashString).digest('hex');

console.log('--- GENERADOR DE PLISIO HASH (SHA1) ---');
console.log('Clave API usada: ' + PLISIO_API_KEY);
console.log('Cadena de Hash: ' + hashString);
console.log('--------------------------------');
console.log('EL NUEVO SECRET ES: ' + expectedSecret);