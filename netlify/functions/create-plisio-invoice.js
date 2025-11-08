// netlify/functions/create-plisio-invoice.js

const axios = require('axios');
const { URLSearchParams } = require('url'); 

exports.handler = async (event, context) => {
    // 💡 CAMBIO DE LOG: para reflejar la última prueba
    console.log("--- INICIO DE EJECUCIÓN DE FUNCIÓN PLISIO (PRUEBA FINAL AXIOS PAYLOAD) ---");

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
    
    // 🎯 CONFIGURACIÓN: Usando BTC para la prueba de descarte.
    const acceptedCurrencies = 'BTC'; 
    
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
        
        // --- NUEVO PAYLOAD COMO OBJETO (FÁCIL DE LEER) ---
        const payloadData = {
            api_key: apiKey,
            order_name: "Recarga de Servicios Malok",
            order_number: `MALOK-${Date.now()}`, 
            currency: 'USD', 
            amount: finalAmountUSD,
            currency_in: acceptedCurrencies, 
            callback_url: callbackUrl, 
            success_url: successUrl, 
            // El campo 'custom' permanece removido para la prueba
        };
        // ----------------------------------------------------

        console.log("DEBUG: Intentando crear la factura en Plisio...");
        
        // 💡 CAMBIO CLAVE: Usamos 'transformRequest' para garantizar el formato x-www-form-urlencoded
        const response = await axios.post('https://plisio.net/api/v1/invoices/new', payloadData, {
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded' 
            },
            transformRequest: [(data, headers) => {
                // Forzamos la codificación usando URLSearchParams para asegurar el formato correcto.
                return new URLSearchParams(data).toString();
            }],
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
        
        let errorDetails = error.message;
        if (error.response && error.response.status === 500) {
            // Este es el último punto de falla que indica un problema de API Key o monto mínimo.
            errorDetails = `Plisio Status 500. La única causa restante es: **API Key incorrecta o revocada** en Plisio, o el monto ($${finalAmountUSD}) es menor al mínimo requerido para BTC.`;
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