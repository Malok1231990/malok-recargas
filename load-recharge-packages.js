// netlify/functions/create-plisio-invoice.js

const axios = require('axios');
const { URLSearchParams } = require('url'); 

exports.handler = async (event, context) => {
    console.log("--- INICIO DE EJECUCIÓN DE FUNCIÓN PLISIO ---");

    if (event.httpMethod !== 'POST') {
        console.log(`DEBUG: Método HTTP no permitido: ${event.httpMethod}`);
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    
    // 🔑 1. OBTENER Y LIMPIAR VARIABLES DE ENTORNO
    const apiKey = process.env.PLISIO_API_KEY; 
    const siteUrl = process.env.NETLIFY_SITE_URL;
    
    // CORRECCIÓN CRÍTICA: Eliminar la barra diagonal final de la URL si existe.
    const siteUrlClean = siteUrl.endsWith('/') ? siteUrl.slice(0, -1) : siteUrl;

    const callbackUrl = `${siteUrlClean}/.netlify/functions/plisio-webhook`;
    const successUrl = siteUrlClean; 
    
    console.log(`DEBUG: API Key cargada: ${!!apiKey}`);
    console.log(`DEBUG: Site URL limpia: ${siteUrlClean}`);
    console.log(`DEBUG: URL de Callback (Webhook): ${callbackUrl}`);


    if (!apiKey || !siteUrl) {
        console.error("ERROR: Faltan credenciales de Plisio (API Key o Site URL).");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración. Faltan credenciales de Plisio." }) 
        };
    }

    let data;
    try {
        data = JSON.parse(event.body);
        console.log("DEBUG: Cuerpo de la solicitud JSON parseado correctamente.");
    } catch (parseError) {
        console.error(`ERROR: Fallo al parsear JSON del cuerpo: ${parseError.message}`);
        return { statusCode: 400, body: JSON.stringify({ message: 'Formato de cuerpo de solicitud inválido.' }) };
    }
    
    // 🚨 SOLUCIÓN AL REFERENCEERROR: Definir 'acceptedCurrencies' fuera del try
    const acceptedCurrencies = 'USDT_TRX,USDT_BSC'; 
    console.log(`DEBUG: Monedas aceptadas configuradas: ${acceptedCurrencies}`);

    try {
        const { amount, email, whatsapp, cartDetails } = data; 
        console.log(`DEBUG: Datos recibidos: Monto=${amount}, Email=${email}`);

        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0 || !email) {
            console.error("ERROR: Datos de transacción incompletos o inválidos.");
            return { statusCode: 400, body: JSON.stringify({ message: 'Datos de transacción incompletos o inválidos.' }) };
        }
        
        const feePercentage = 0.03; 
        const amountValue = parseFloat(amount);
        const amountWithFee = amountValue * (1 + feePercentage); 
        const finalAmountUSD = amountWithFee.toFixed(2);
        
        console.log(`DEBUG: Monto inicial: ${amountValue.toFixed(2)}`);
        console.log(`DEBUG: Monto final con comisión: ${finalAmountUSD} USD`);
        
        
        const payload = new URLSearchParams({
            api_key: apiKey,
            order_name: "Recarga de Servicios Malok",
            order_number: `MALOK-${Date.now()}`, 
            currency: 'USD', 
            amount: finalAmountUSD,
            currency_in: acceptedCurrencies, // Lista de monedas para el cliente
            callback_url: callbackUrl, 
            success_url: successUrl, 
            custom: JSON.stringify({
                customer_email: email,
                customer_whatsapp: whatsapp,
                cart_details: typeof cartDetails === 'object' ? JSON.stringify(cartDetails) : cartDetails, 
                original_amount: amountValue.toFixed(2),
            }),
        }).toString();

        // 💡 Log del Payload ANTES de enviarlo
        console.log(`DEBUG: Payload enviado a Plisio: ${payload}`);

        console.log("DEBUG: Intentando crear la factura en Plisio...");
        const response = await axios.post('https://plisio.net/api/v1/invoices/new', payload, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        
        const plisioData = response.data;
        console.log(`DEBUG: Respuesta de Plisio recibida. Status: ${plisioData.status}`);
        console.log(`DEBUG: Datos de respuesta de Plisio: ${JSON.stringify(plisioData)}`);


        if (plisioData.status === 'ok' && plisioData.data && plisioData.data.invoice_url) {
            
            console.log("--- FINALIZACIÓN EXITOSA DE FUNCIÓN (Factura Creada) ---");
            
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chargeUrl: plisioData.data.invoice_url, 
                    chargeId: plisioData.data.txn_id, 
                }),
            };
        } else {
            // Manejo de error de la API de Plisio que regresa un JSON de error
            const errorMessage = plisioData.data && plisioData.data.message ? `Plisio API Error: ${plisioData.data.message}` : 'Error desconocido de la API de Plisio';
            console.error(`ERROR: Fallo al crear factura de Plisio (Respuesta JSON): ${errorMessage}`);
            throw new Error(errorMessage);
        }

    } catch (error) {
        // En caso de error de conexión o error de Axios (como el 500 que viste)
        console.error(`ERROR: Fallo de conexión o Axios: ${error.message}`);
        
        let errorDetails = error.message;

        if (error.response) {
            console.error(`ERROR AXIOS: Recibido Status Code ${error.response.status}`);
            console.error(`ERROR AXIOS: Datos de Respuesta: ${error.response.data}`);

            if (error.response.status === 500) {
                // Este bloque ahora funciona correctamente gracias a la corrección de 'acceptedCurrencies'
                errorDetails = `Plisio Status 500. Posibles causas: Monedas no activadas (${acceptedCurrencies}), API Key inválida, o datos de payload incorrectos.`;
            } else if (error.response.status === 400) {
                 errorDetails = `Plisio Status 400 (Bad Request). Revisa el formato del payload.`;
            }
        }
        
        console.error(`DETALLE FINAL DE ERROR: ${errorDetails}`); 

        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message: `Error al crear la factura de pago.`,
                details: errorDetails
            }),
        };
    }
};