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
    
    // 🚨 CORRECCIÓN CRÍTICA: Eliminar la barra diagonal final de la URL si existe.
    const siteUrlClean = siteUrl.endsWith('/') ? siteUrl.slice(0, -1) : siteUrl;

    const callbackUrl = `${siteUrlClean}/.netlify/functions/plisio-webhook`;
    // Asumimos que la URL de éxito es la página principal limpia.
    const successUrl = siteUrlClean; 
    
    console.log(`DEBUG: API Key cargada: ${!!apiKey}`);
    console.log(`DEBUG: Site URL limpia: ${siteUrlClean}`);
    console.log(`DEBUG: Callback URL: ${callbackUrl}`);


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
    
    try {
        const { amount, email, whatsapp, cartDetails } = data; 

        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0 || !email) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Datos de transacción incompletos o inválidos.' }) };
        }
        
        // Aplicar comisión del 3% (Lógica mantenida)
        const feePercentage = 0.03; 
        const amountValue = parseFloat(amount);
        const amountWithFee = amountValue * (1 + feePercentage); 
        const finalAmountUSD = amountWithFee.toFixed(2);
        
        console.log(`DEBUG: Monto final con comisión: ${finalAmountUSD} USD`);
        
        // 🚨 2. CREAR EL PAYLOAD PARA LA API DE PLISIO
        const payload = new URLSearchParams({
            api_key: apiKey,
            order_name: "Recarga de Servicios Malok",
            order_number: `MALOK-${Date.now()}`, 
            currency: 'USD', 
            amount: finalAmountUSD,
            currency_in: 'BTC,ETH,USDT_TRX,LTC', 
            // 🚨 USAMOS LA URL LIMPIA AQUÍ
            callback_url: callbackUrl, 
            success_url: successUrl, 
            custom: JSON.stringify({
                customer_email: email,
                customer_whatsapp: whatsapp,
                cart_details: typeof cartDetails === 'object' ? JSON.stringify(cartDetails) : cartDetails, 
                original_amount: amountValue.toFixed(2),
            }),
        }).toString();

        // 🚨 3. LLAMADA POST AL ENDPOINT DE FACTURACIÓN DE PLISIO
        console.log("DEBUG: Intentando crear la factura en Plisio...");
        const response = await axios.post('https://plisio.net/api/v1/invoices/new', payload, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        
        const plisioData = response.data;

        if (plisioData.status === 'ok' && plisioData.data && plisioData.data.invoice_url) {
            
            console.log(`DEBUG: Factura creada exitosamente. ID: ${plisioData.data.txn_id}`);
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
            const errorMessage = plisioData.data && plisioData.data.message ? plisioData.data.message : 'Error desconocido de la API de Plisio';
            console.error(`ERROR: Fallo al crear factura de Plisio: ${errorMessage}`);
            throw new Error(errorMessage);
        }

    } catch (error) {
        // En caso de error de conexión (como el 500/404 que viste)
        console.error(`ERROR: Fallo al crear la Factura de Plisio: ${error.message}`);
        
        // Incluye la respuesta del servidor (si está disponible) para mejor diagnóstico.
        const responseData = error.response ? JSON.stringify(error.response.data).substring(0, 200) + '...' : 'N/A';
        console.error(`ERROR DETALLADO (Data): ${responseData}`); 

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