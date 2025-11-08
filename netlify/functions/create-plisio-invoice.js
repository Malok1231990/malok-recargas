// netlify/functions/create-plisio-invoice.js

const axios = require('axios');
const { URLSearchParams } = require('url'); 

exports.handler = async (event, context) => {
    console.log("--- INICIO DE EJECUCIÓN DE FUNCIÓN PLISIO (CORRECCIÓN FINAL DE RUTA Y COMANDO) ---");

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    
    // 🔑 1. OBTENER Y LIMPIAR VARIABLES DE ENTORNO
    const apiKey = process.env.PLISIO_API_KEY; 
    const siteUrl = process.env.NETLIFY_SITE_URL;
    
    // Eliminar la barra diagonal final de la URL si existe.
    const siteUrlClean = siteUrl.endsWith('/') ? siteUrl.slice(0, -1) : siteUrl;

    const callbackUrl = `${siteUrlClean}/.netlify/functions/plisio-webhook`;
    const successUrl = siteUrlClean; 
    
    console.log(`TRAZA 2: API Key cargada: ${!!apiKey} (true si se cargó)`);
    console.log(`TRAZA 4: Callback URL para Plisio: ${callbackUrl}`);

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
    
    const acceptedCurrencies = 'BTC'; 
    let finalAmountUSD = '0.00'; 
    
    try {
        const { amount, email, whatsapp, cartDetails } = data; 

        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0 || !email) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Datos de transacción incompletos o inválidos.' }) };
        }
        
        const feePercentage = 0.03; 
        const amountValue = parseFloat(amount);
        const amountWithFee = amountValue * (1 + feePercentage); 
        
        finalAmountUSD = amountWithFee.toFixed(2);
        
        console.log(`TRAZA 12: Monto final con comisión (3%): ${finalAmountUSD} USD`);
        
        // --- PAYLOAD FINAL CON EL COMANDO DENTRO ---
        const payloadData = {
            // El comando debe ir en el cuerpo (Body) para Plisio.
            cmd: 'create_invoice', 
            api_key: apiKey,
            order_name: "Recarga de Servicios Malok",
            order_number: `MALOK-${Date.now()}`, 
            currency: 'USD', 
            amount: finalAmountUSD,
            currency_in: acceptedCurrencies, 
            callback_url: callbackUrl, 
            success_url: successUrl, 
        };
        // ----------------------------------------------------
        
        // 🚀 CORRECCIÓN CLAVE: Usamos la URL sin el slash final ni '/new'.
        const PLISIO_INVOICE_URL = 'https://plisio.net/api/v1/invoices'; 

        console.log("TRAZA 14: Iniciando solicitud POST a Plisio...");
        
        // USAMOS transformRequest para garantizar el formato x-www-form-urlencoded
        const response = await axios.post(PLISIO_INVOICE_URL, payloadData, {
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded' 
            },
            transformRequest: [(data, headers) => {
                return new URLSearchParams(data).toString();
            }],
        });
        
        const plisioData = response.data;
        console.log(`TRAZA 16: Respuesta de Plisio recibida. Status general: ${plisioData.status}`);

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
            console.error(`TRAZA 18: ERROR: Fallo al crear factura de Plisio. Respuesta de la API no "ok": ${errorMessage}`);
            throw new Error(errorMessage);
        }

    } catch (error) {
        // Diagnóstico para errores de conexión o ejecución
        console.error(`TRAZA 19: ERROR DE CONEXIÓN O EJECUCIÓN: ${error.message}`);
        
        let errorDetails = error.message;
        
        if (error.response) {
            console.error(`TRAZA 20: El error es una respuesta de Axios. Status HTTP: ${error.response.status}`);
            console.error(`TRAZA 21: Cuerpo de la RESPUESTA de ERROR (HTML/Texto/JSON):`);
            console.error(error.response.data); 
            
            if (error.response.status === 422) {
                 // Diagnóstico específico para el error 422
                 errorDetails = 'Plisio Status 422: Por favor, **genere una nueva API Key** en su panel de Plisio y actualice la variable de entorno en Netlify.';
            } else if (error.response.status === 404 || error.response.status === 500) {
                 // Si regresa 404/500, la URL es el problema (lo cual ya corregimos arriba) o la API Key.
                 errorDetails = 'Plisio Status 404/500: Revise si la API Key es correcta.';
            }
            
        } 
        
        console.error(`DETALLE DE ERROR FINAL: ${errorDetails}`); 

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