// netlify/functions/create-coinbase-charge.js
const { Client } = require('coinbase-commerce-node');

// Inicializa el cliente de Coinbase Commerce
// La clave se lee de la variable de entorno COINBASE_COMMERCE_API_KEY
Client.init(process.env.COINBASE_COMMERCE_API_KEY); 
const { Charge } = Client;

exports.handler = async (event, context) => {
    // 1. Verificar el método y la configuración
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    
    if (!process.env.COINBASE_COMMERCE_API_KEY || !process.env.NETLIFY_SITE_URL) {
        console.error("Faltan variables de entorno críticas.");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración del servidor. Falta la API Key o la URL del sitio." }) 
        };
    }

    try {
        const data = JSON.parse(event.body);
        // Los datos vienen del frontend (payment.html)
        const { amount, email, whatsapp, cartDetails } = data; 

        // 2. Validaciones básicas
        if (!amount || parseFloat(amount) <= 0 || !email) {
             return { statusCode: 400, body: JSON.stringify({ message: 'Datos de transacción incompletos o inválidos.' }) };
        }
        
        // Opcional: Aplicar un pequeño recargo por costos de red/procesamiento (ejemplo del 3%)
        const feePercentage = 0.03; 
        const amountWithFee = parseFloat(amount) * (1 + feePercentage); 
        const finalAmountUSD = amountWithFee.toFixed(2);
        
        // 3. Crear la factura (Charge) en Coinbase Commerce
        const charge = await Charge.create({
            name: "Recarga de Servicios Malok",
            description: "Pago por carrito de recargas - Malok Recargas",
            local_price: {
                amount: finalAmountUSD,
                currency: 'USD',
            },
            pricing_type: 'fixed_price',
            // Redirige al index de tu sitio al completar el pago
            redirect_url: process.env.NETLIFY_SITE_URL, 
            // Redirige a la página de pago en caso de cancelación
            cancel_url: `${process.env.NETLIFY_SITE_URL}/payment.html`, 
            metadata: {
                // Guarda la información importante para el procesamiento post-pago
                customer_email: email,
                customer_whatsapp: whatsapp,
                cart_details: cartDetails, 
                original_amount: parseFloat(amount).toFixed(2), // Monto antes de la comisión (opcional)
            },
        });

        // 4. Respuesta exitosa al frontend con la URL de pago
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chargeUrl: charge.hosted_url, // URL a la que se redirige el cliente
                chargeId: charge.id,
            }),
        };

    } catch (error) {
        console.error('Error al crear Coinbase Commerce charge:', error.message);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'Error interno del servidor al crear la factura de pago.' }),
        };
    }
};