// netlify/functions/create-coinbase-charge.js
const { Client } = require('coinbase-commerce-node');

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    
    const apiKey = process.env.COINBASE_COMMERCE_API_KEY;
    const siteUrl = process.env.NETLIFY_SITE_URL;

    // 1. Validar variables de entorno críticas
    if (!apiKey || !siteUrl) {
        console.error("ERROR: COINBASE_COMMERCE_API_KEY o NETLIFY_SITE_URL están faltando.");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración del servidor. Faltan credenciales." }) 
        };
    }

    let Charge;
    try {
        // 🛑 Inicialización obligatoria y obtención de Charge dentro del handler 
        // para garantizar que se realice en el contexto correcto.
        Client.init(apiKey); 
        Charge = Client.Charge; 
        
        if (typeof Charge !== 'function') {
            // Este error solo debe ocurrir si la API Key es totalmente inválida.
            throw new Error("Coinbase Commerce no pudo cargar el modelo de pago. Verifique la API Key.");
        }
        
    } catch (initError) {
        console.error("ERROR: Fallo en la inicialización de Coinbase:", initError.message);
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error interno del servicio de pago (Init)." }) 
        };
    }

    let data;
    try {
        data = JSON.parse(event.body);
    } catch (parseError) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Formato de cuerpo de solicitud inválido.' }) };
    }

    try {
        const { amount, email, whatsapp, cartDetails } = data; 

        // 2. Validaciones básicas
        if (!amount || parseFloat(amount) <= 0 || !email) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Datos de transacción incompletos o inválidos.' }) };
        }
        
        // Aplicar comisión del 3%
        const feePercentage = 0.03; 
        const amountWithFee = parseFloat(amount) * (1 + feePercentage); 
        const finalAmountUSD = amountWithFee.toFixed(2);
        
        // 3. Crear la factura (Charge)
        const charge = await Charge.create({
            name: "Recarga de Servicios Malok",
            description: "Pago por carrito de recargas - Malok Recargas",
            local_price: {
                amount: finalAmountUSD,
                currency: 'USD',
            },
            pricing_type: 'fixed_price',
            redirect_url: siteUrl, 
            cancel_url: `${siteUrl}/payment.html`, 
            metadata: {
                customer_email: email,
                customer_whatsapp: whatsapp,
                cart_details: cartDetails, 
                original_amount: parseFloat(amount).toFixed(2),
            },
        });

        // 4. Respuesta exitosa
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chargeUrl: charge.hosted_url,
                chargeId: charge.id,
            }),
        };

    } catch (error) {
        console.error(`ERROR: Fallo al crear Coinbase Charge: ${error.message}`);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message: `Error al crear la factura de pago.`,
                details: error.message
            }),
        };
    }
};