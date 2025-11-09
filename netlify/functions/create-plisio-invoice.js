// netlify/functions/create-plisio-invoice.js

const axios = require('axios');
const { URLSearchParams } = require('url'); 
// URLSearchParams ahora se usa para construir la cadena de consulta (query string)

exports.handler = async (event, context) => {
    console.log("--- INICIO DE EJECUCIÓN DE FUNCIÓN PLISIO (CORRECCIÓN FINAL: CAMBIO a GET) ---");

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    
    // 🔑 1. OBTENER Y LIMPIAR VARIABLES DE ENTORNO
    const apiKey = process.env.PLISIO_API_KEY; 
    const siteUrl = process.env.NETLIFY_SITE_URL;
    
    // Eliminar la barra diagonal final de la URL si existe.
    const siteUrlClean = siteUrl.endsWith('/') ? siteUrl.slice(0, -1) : siteUrl;

    // La URL de callback/success sigue siendo la misma.
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
        // Aunque no se usan aquí, se extraen para verificar su existencia
        const { amount, email, whatsapp, cartDetails } = data; 

        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0 || !email) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Datos de transacción incompletos o inválidos.' }) };
        }
        
        const feePercentage = 0.03; 
        const amountValue = parseFloat(amount);
        const amountWithFee = amountValue * (1 + feePercentage); 
        
        finalAmountUSD = amountWithFee.toFixed(2);
        
        console.log(`TRAZA 12: Monto final con comisión (3%): ${finalAmountUSD} USD`);
        
        // --- PAYLOAD FINAL - LOS DATOS SE CONVERTIRÁN EN QUERY PARAMETERS ---
        const payloadData = {
            // El comando debe ir en la URL para Plisio (como query param)
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
        
        // 🚀 CORRECCIÓN CLAVE: Usamos la URL base de la API
        const PLISIO_BASE_URL = 'https://api.plisio.net/api/v1'; 
        
        // Convertir los datos a una cadena de consulta (query string)
        const queryString = new URLSearchParams(payloadData).toString();
        
        // Construir la URL final con todos los parámetros
        const PLISIO_FINAL_URL = `${PLISIO_BASE_URL}?${queryString}`;


        console.log("TRAZA 14: Iniciando solicitud GET a Plisio...");
        
        // **CORRECCIÓN CLAVE: Usamos axios.get en lugar de axios.post**
        // Pasamos la URL final que contiene todos los parámetros de Plisio.
        const response = await axios.get(PLISIO_FINAL_URL);
        
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
                 // El error 422 podría seguir ocurriendo si la API Key es incorrecta o el dominio no está verificado.
                 errorDetails = 'Plisio Status 422: Falló la solicitud. Por favor, asegúrese de que la **API Key es correcta** y el **dominio está verificado** en el panel de Plisio.';
            } else if (error.response.status === 404 || error.response.status === 500) {
                 errorDetails = 'Plisio Status 404/500: Revise la URL o si la API Key es correcta.';
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