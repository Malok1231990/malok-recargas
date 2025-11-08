// netlify/functions/create-coinbase-charge.js
const { Client } = require('coinbase-commerce-node');

console.log("DEBUG: 1. Dependencia coinbase-commerce-node cargada.");

// --- Inicialización del Cliente ---
const apiKey = process.env.COINBASE_COMMERCE_API_KEY;

// 🛑 CLAVE DE DIAGNÓSTICO
console.log(`DEBUG: 2. API Key length (debe ser > 0): ${apiKey ? apiKey.length : '0'}`);

try {
    Client.init(apiKey); 
    console.log("DEBUG: 3. Cliente de Coinbase inicializado.");
} catch (initError) {
    console.error("ERROR CRÍTICO DE INICIALIZACIÓN DE CLIENTE:", initError.message);
    // Si la inicialización falla aquí, Client podría no tener el objeto Charge.
}

const { Charge } = Client;

// 🛑 CLAVE DE DIAGNÓSTICO
console.log(`DEBUG: 4. Tipo de Charge (debe ser 'function'): ${typeof Charge}`);
if (typeof Charge !== 'function') {
    // Este mensaje aparecerá si el problema persiste.
    console.error("ERROR CRÍTICO: El objeto Charge no se cargó. API KEY VACÍA O INVÁLIDA.");
}


exports.handler = async (event, context) => {
    console.log("DEBUG: 5. Handler iniciado.");
    
    // 1. Verificar el método y la configuración
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    if (!apiKey || !process.env.NETLIFY_SITE_URL) {
        console.error("ERROR: COINBASE_COMMERCE_API_KEY o NETLIFY_SITE_URL están faltando.");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración del servidor. Falta la API Key o la URL del sitio. Revisar Netlify." }) 
        };
    }
    
    let data;
    try {
        data = JSON.parse(event.body);
        console.log("DEBUG: 6. Body parseado exitosamente.");
    } catch (parseError) {
        console.error("ERROR: No se pudo parsear el body del request:", parseError);
        return { statusCode: 400, body: JSON.stringify({ message: 'Formato de cuerpo de solicitud inválido.' }) };
    }

    try {
        const { amount, email } = data; 
        console.log(`DEBUG: 7. Datos de entrada: Email=${email}, Amount=${amount}`);

        // 2. Validaciones básicas
        if (!amount || parseFloat(amount) <= 0 || !email) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Datos de transacción incompletos o inválidos.' }) };
        }
        
        const feePercentage = 0.03; 
        const amountWithFee = parseFloat(amount) * (1 + feePercentage); 
        const finalAmountUSD = amountWithFee.toFixed(2);
        console.log(`DEBUG: 8. Monto final con comisión: ${finalAmountUSD} USD`);
        
        // 3. Crear la factura (Charge) en Coinbase Commerce
        // Si el problema de "undefined" persiste, ocurrirá aquí.
        const charge = await Charge.create({ 
            name: "Recarga de Servicios Malok",
            description: "Pago por carrito de recargas - Malok Recargas",
            local_price: {
                amount: finalAmountUSD,
                currency: 'USD',
            },
            pricing_type: 'fixed_price',
            redirect_url: process.env.NETLIFY_SITE_URL, 
            cancel_url: `${process.env.NETLIFY_SITE_URL}/payment.html`, 
            metadata: {
                customer_email: email,
                customer_whatsapp: data.whatsapp,
                cart_details: data.cartDetails, 
                original_amount: parseFloat(amount).toFixed(2),
            },
        });
        
        console.log(`DEBUG: 9. Factura creada con éxito. ID: ${charge.id}`);

        // 4. Respuesta exitosa al frontend con la URL de pago
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chargeUrl: charge.hosted_url,
                chargeId: charge.id,
            }),
        };

    } catch (error) {
        // Enviaremos un mensaje de error más específico si falla la creación.
        console.error(`ERROR CATCH (Paso 10): Error al crear Coinbase Commerce charge: ${error.message}`);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message: `Error interno: ${error.message}. Por favor, verifica la API Key de Coinbase en la configuración de Netlify.`,
                details: error.message
            }),
        };
    }
};