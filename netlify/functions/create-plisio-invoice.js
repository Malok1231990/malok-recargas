// netlify/functions/create-plisio-invoice.js

// 1. Importamos la librería 'axios' para hacer peticiones HTTP a la API REST de Plisio
const axios = require('axios');
const { URLSearchParams } = require('url'); // Necesario para serializar el cuerpo de la petición

exports.handler = async (event, context) => {
    console.log("--- INICIO DE EJECUCIÓN DE FUNCIÓN PLISIO ---");

    // 🛑 0. Validar método HTTP
    if (event.httpMethod !== 'POST') {
        console.log(`INFO: Método no permitido: ${event.httpMethod}`);
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    
    // 🔑 1. NUEVAS VARIABLES DE ENTORNO
    const apiKey = process.env.PLISIO_API_KEY; // 👈 NUEVA CLAVE DE PLISIO
    const siteUrl = process.env.NETLIFY_SITE_URL;
    // Usaremos esta URL para el callback, debe coincidir con la configurada en el Dashboard
    const callbackUrl = `${siteUrl}/.netlify/functions/plisio-webhook`;
    
    console.log(`DEBUG: API Key cargada: ${!!apiKey}`);
    console.log(`DEBUG: Site URL cargada: ${!!siteUrl}`);

    // 2. Validar variables de entorno críticas
    if (!apiKey || !siteUrl) {
        console.error("ERROR: PLISIO_API_KEY o NETLIFY_SITE_URL están faltando.");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración del servidor. Faltan credenciales de Plisio." }) 
        };
    }

    let data;
    try {
        console.log("DEBUG: Intentando parsear el cuerpo de la solicitud...");
        data = JSON.parse(event.body);
        console.log("DEBUG: Cuerpo de la solicitud parseado exitosamente.");
    } catch (parseError) {
        console.error("ERROR: Fallo al parsear JSON:", parseError.message);
        return { statusCode: 400, body: JSON.stringify({ message: 'Formato de cuerpo de solicitud inválido.' }) };
    }
    
    console.log(`DEBUG: Datos recibidos -> Amount: ${data.amount}, Email: ${data.email}`);

    try {
        const { amount, email, whatsapp, cartDetails } = data; 

        // 3. Validaciones básicas de la solicitud
        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0 || !email) {
            console.error("ERROR: Validaciones fallidas. Datos:", { amount, email });
            return { statusCode: 400, body: JSON.stringify({ message: 'Datos de transacción incompletos o inválidos.' }) };
        }
        
        // Aplicar comisión del 3% (Lógica mantenida de tu código)
        const feePercentage = 0.03; 
        const amountValue = parseFloat(amount);
        const amountWithFee = amountValue * (1 + feePercentage); 
        const finalAmountUSD = amountWithFee.toFixed(2);
        
        console.log(`DEBUG: Monto original: ${amountValue}`);
        console.log(`DEBUG: Monto final con comisión: ${finalAmountUSD} USD`);
        
        // 🚨 4. CREAR EL PAYLOAD PARA LA API DE PLISIO (Formato x-www-form-urlencoded)
        const payload = new URLSearchParams({
            api_key: apiKey,
            order_name: "Recarga de Servicios Malok",
            order_number: `MALOK-${Date.now()}`, // ID único para la orden
            currency: 'USD', // La moneda en la que se fija el precio
            amount: finalAmountUSD,
            // Lista de monedas que el cliente puede pagar (ajusta según tus activaciones en Plisio)
            currency_in: 'BTC,ETH,USDT_TRX,LTC', 
            // URL a donde enviará la notificación cuando el cliente pague
            callback_url: callbackUrl, 
            // URL de éxito
            success_url: siteUrl, // Redirige al inicio (o a una página de éxito si tienes una específica)
            // Metadatos (custom) para recuperar en el webhook
            custom: JSON.stringify({
                customer_email: email,
                customer_whatsapp: whatsapp,
                cart_details: typeof cartDetails === 'object' ? JSON.stringify(cartDetails) : cartDetails, 
                original_amount: amountValue.toFixed(2),
            }),
        }).toString();

        // 🚨 5. LLAMADA POST AL ENDPOINT DE FACTURACIÓN DE PLISIO
        console.log("DEBUG: Intentando crear la factura en Plisio...");
        const response = await axios.post('https://plisio.net/api/v1/invoices/new', payload, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        
        const plisioData = response.data;
        console.log(`DEBUG: Respuesta de Plisio recibida. Status: ${plisioData.status}`);


        if (plisioData.status === 'ok' && plisioData.data && plisioData.data.invoice_url) {
            
            // 6. Respuesta exitosa
            console.log(`DEBUG: Factura creada exitosamente. URL: ${plisioData.data.invoice_url}`);
            console.log("--- FINALIZACIÓN EXITOSA DE FUNCIÓN ---");
            
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    // Devolvemos la URL de redirección (hosted_url)
                    chargeUrl: plisioData.data.invoice_url, 
                    // ID de la transacción de Plisio
                    chargeId: plisioData.data.txn_id, 
                }),
            };
        } else {
            // Manejo de error de la API de Plisio
            const errorMessage = plisioData.data && plisioData.data.message ? plisioData.data.message : 'Error desconocido de la API de Plisio';
            console.error(`ERROR: Fallo al crear factura de Plisio: ${errorMessage}`);
            throw new Error(errorMessage);
        }

    } catch (error) {
        console.error(`ERROR: Fallo al crear la Factura de Plisio: ${error.message}`);
        console.error("ERROR DETALLADO (Stack):", error); 
        
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message: `Error al crear la factura de pago.`,
                details: error.message || 'Error desconocido al interactuar con Plisio.'
            }),
        };
    }
};