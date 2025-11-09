// netlify/functions/create-plisio-invoice.js

const axios = require('axios');
const { URLSearchParams } = require('url'); 

exports.handler = async (event, context) => {
    // Trazas actualizadas para la URL final
    console.log("--- INICIO DE EJECUCIÓN DE FUNCIÓN PLISIO (SOLUCIÓN FINAL: /invoices/new) ---");

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    
    // 🔑 1. OBTENER Y LIMPIAR VARIABLES DE ENTORNO
    const apiKey = process.env.PLISIO_API_KEY; 
    const siteUrl = process.env.NETLIFY_SITE_URL;
    
    const siteUrlClean = siteUrl.endsWith('/') ? siteUrl.slice(0, -1) : siteUrl;

    // Nota: Es crucial agregar el parámetro 'json=true' a las URLs de callback/success
    // para asegurar que Plisio responda con JSON y no con el formato PHP por defecto.
    const callbackUrl = `${siteUrlClean}/.netlify/functions/plisio-webhook?json=true`;
    const successUrl = `${siteUrlClean}/payment.html?status=success&json=true`;
    
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
    
    let finalAmountUSD = '0.00'; 
    
    try {
        // Obtenemos los datos necesarios de la solicitud POST
        const { amount, email } = data; 
        
        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0 || !email) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Datos de transacción incompletos o inválidos.' }) };
        }
        
        const feePercentage = 0.03; 
        const amountValue = parseFloat(amount);
        const amountWithFee = amountValue * (1 + feePercentage); 
        
        finalAmountUSD = amountWithFee.toFixed(2);
        
        console.log(`TRAZA 12: Monto final con comisión (3%): ${finalAmountUSD} USD`);
        
        // --- PAYLOAD FINAL ---
        const payloadData = {
            api_key: apiKey,
            source_currency: 'USD', 
            source_amount: finalAmountUSD,
            order_name: "Recarga de Servicios Malok",
            order_number: `MALOK-${Date.now()}`, 
            
            // 🚀 CAMBIO CLAVE: Configurado para USDT (TRC-20 y BEP-20)
            allowed_psys_cids: 'USDT_TRX,USDT_BSC', 
            
            email: email, 
            callback_url: callbackUrl, 
            success_invoice_url: successUrl, 
        };
        // ----------------------------------------------------
        
        const PLISIO_INVOICES_URL = 'https://api.plisio.net/api/v1/invoices/new'; 
        
        const queryString = new URLSearchParams(payloadData).toString();
        
        const PLISIO_FINAL_URL = `${PLISIO_INVOICES_URL}?${queryString}`;


        console.log("TRAZA 14: Iniciando solicitud GET a Plisio...");
        
        const response = await axios.get(PLISIO_FINAL_URL);
        
        const plisioData = response.data;
        console.log(`TRAZA 16: Respuesta de Plisio recibida. Status general: ${plisioData.status}`);

        if (plisioData.status === 'success' && plisioData.data && plisioData.data.invoice_url) {
            
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
            console.error(`TRAZA 18: ERROR: Fallo al crear factura de Plisio. Respuesta de la API no "success": ${errorMessage}`);
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
            
            if (error.response.status === 404) {
                 errorDetails = 'Plisio Status 404: La URL de la API es incorrecta. Asegúrese de que la ruta es *https://api.plisio.net/api/v1/invoices/new*.';
            } else if (error.response.status === 422 || error.response.status === 401) {
                 errorDetails = 'Plisio Status 422/401: Falló la solicitud. Por favor, asegúrese de que la **API Key es correcta** y el **dominio está verificado** en el panel de Plisio.';
            } else if (error.response.status === 400) {
                 errorDetails = `Plisio Status 400: Parámetro de solicitud inválido o faltante. Revise el 'order_number', 'source_amount' o 'email'.`;
            } else if (error.response.status >= 500) {
                 errorDetails = 'Error 5xx: Problema interno del servidor de Plisio. Inténtelo más tarde.';
            } else {
                 errorDetails = `Error HTTP no manejado: ${error.response.status}`;
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