// netlify/functions/create-plisio-invoice.js

const axios = require('axios');
const { URLSearchParams } = require('url'); 

exports.handler = async (event, context) => {
    console.log("--- INICIO DE EJECUCIÓN DE FUNCIÓN PLISIO ---");

    if (event.httpMethod !== 'POST') {
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


    if (!apiKey || !siteUrl) {
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración. Faltan credenciales de Plisio." }) 
        };
    }

    let data;
    try {
        data = JSON.parse(event.body);
    } catch (parseError) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Formato de cuerpo de solicitud inválido.' }) };
    }
    
    // 💡 SOLUCIÓN MÁS PROBABLE AL ERROR 500: Cambiar separador de monedas de coma a ESPACIO.
    // Esto es común para listas en payloads application/x-www-form-urlencoded
    const acceptedCurrencies = 'USDT_TRX USDT_BSC'; // Separado por ESPACIO
    
    try {
        const { amount, email, whatsapp, cartDetails } = data; 

        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0 || !email) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Datos de transacción incompletos o inválidos.' }) };
        }
        
        const feePercentage = 0.03; 
        const amountValue = parseFloat(amount);
        const amountWithFee = amountValue * (1 + feePercentage); 
        const finalAmountUSD = amountWithFee.toFixed(2);
        
        console.log(`DEBUG: Monto final con comisión: ${finalAmountUSD} USD`);
        
        // La variable acceptedCurrencies ya está definida arriba.

        const payload = new URLSearchParams({
            api_key: apiKey,
            order_name: "Recarga de Servicios Malok",
            order_number: `MALOK-${Date.now()}`, 
            currency: 'USD', 
            amount: finalAmountUSD,
            currency_in: acceptedCurrencies, // 👈 USANDO ESPACIO COMO SEPARADOR
            callback_url: callbackUrl, 
            success_url: successUrl, 
            custom: JSON.stringify({
                customer_email: email,
                customer_whatsapp: whatsapp,
                cart_details: typeof cartDetails === 'object' ? JSON.stringify(cartDetails) : cartDetails, 
                original_amount: amountValue.toFixed(2),
            }),
        }).toString();

        console.log("DEBUG: Intentando crear la factura en Plisio...");
        const response = await axios.post('https://plisio.net/api/v1/invoices/new', payload, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        
        const plisioData = response.data;
        console.log(`DEBUG: Respuesta de Plisio recibida. Status: ${plisioData.status}`);

        if (plisioData.status === 'ok' && plisioData.data && plisioData.data.invoice_url) {
            
            console.log("--- FINALIZACIÓN EXITOSA DE FUNCIÓN ---");
            
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
            console.error(`ERROR: Fallo al crear factura de Plisio: ${errorMessage}`);
            throw new Error(errorMessage);
        }

    } catch (error) {
        // En caso de error de conexión (como el 500/404 que viste)
        console.error(`ERROR: Fallo al crear la Factura de Plisio: ${error.message}`);
        
        // Intenta capturar el cuerpo de la respuesta incluso en 500 para diagnosticar el mensaje de Plisio
        let errorDetails = error.message;
        if (error.response && error.response.status === 500) {
            // Este bloque ahora te dirá qué formato intentaste usar (USDT_TRX USDT_BSC)
            errorDetails = `Plisio Status 500. Posibles causas: Monedas no activadas (${acceptedCurrencies}) o API Key inválida.`;
        }
        
        console.error(`DETALLE DE ERROR: ${errorDetails}`); 

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