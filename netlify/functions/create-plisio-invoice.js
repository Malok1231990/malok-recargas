// netlify/functions/create-plisio-invoice.js
const axios = require('axios');
const { URLSearchParams } = require('url'); 
// 🚨 Importar el cliente de Supabase
const { createClient } = require('@supabase/supabase-js');

// Se elimina safeText, se usará || null para los campos opcionales

exports.handler = async (event, context) => {
    console.log("--- INICIO DE EJECUCIÓN DE FUNCIÓN PLISIO (CREACIÓN DE FACTURA) ---");

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    
    // 🔑 1. OBTENER Y LIMPIAR VARIABLES DE ENTORNO
    const apiKey = process.env.PLISIO_API_KEY; 
    const siteUrl = process.env.NETLIFY_SITE_URL;
    
    // 🚨 VARIABLES DE SUPABASE
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    const siteUrlClean = siteUrl.endsWith('/') ? siteUrl.slice(0, -1) : siteUrl;

    // Se mantiene ?json=true para usar la verificación HMAC-SHA1 en el webhook.
    const callbackUrl = `${siteUrlClean}/.netlify/functions/plisio-webhook?json=true`; 
    const successUrl = `${siteUrlClean}/payment.html?status=processing`; 
    
    console.log(`TRAZA 2: API Key cargada: ${!!apiKey} | Callback URL: ${callbackUrl}`);

    if (!apiKey || !siteUrl || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración. Faltan credenciales esenciales (Plisio/Supabase)." }) 
        };
    }
    
    let data;
    try {
        data = JSON.parse(event.body);
    } catch (parseError) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Formato de cuerpo de solicitud inválido.' }) };
    }
    
    let finalAmountUSD = '0.00'; 
    let finalAmountFloat = 0; 
    // Generamos un ID de transacción interno para el seguimiento.
    const orderNumber = `MALOK-${Date.now()}`; 

    // Inicializar Supabase para su uso posterior en caso de fallo.
    let supabase = null; 
    try {
        supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    } catch (dbInitError) {
        console.error("TRAZA 10: Error al inicializar el cliente de Supabase:", dbInitError.message);
        return { statusCode: 500, body: JSON.stringify({ message: "Error al conectar con la base de datos." }) };
    }


    try {
        // OBTENCIÓN DE DATOS
        const { amount, email, whatsapp, cartDetails } = data; 

        // Validaciones básicas
        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0 || !email) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Datos de transacción incompletos o inválidos (monto o email).' }) };
        }

        // Procesar los detalles del producto anidados en cartDetails
        let productDetails = {};
        if (cartDetails) {
            try {
                // Usamos solo el primer ítem para llenar los campos de compatibilidad (game, playerId, etc.)
                const cartArray = JSON.parse(cartDetails);
                productDetails = cartArray.length > 0 ? cartArray[0] : {};
            } catch (e) {
                console.error("TRAZA 11.5: Error al parsear cartDetails, usando objeto vacío.", e.message);
            }
        }
        
        // Mapeo de datos para la base de datos:
        const game = productDetails.game || 'Carrito Múltiple';
        const playerId = productDetails.playerId || null;
        const packageName = productDetails.packageName || 'Múltiples Paquetes';
        const whatsappNumber = whatsapp || null;
        
        // Mapeo de credenciales: Usar || null
        const roblox_email = productDetails.robloxEmail || productDetails.roblox_email || null;
        const roblox_password = productDetails.robloxPassword || productDetails.roblox_password || null;
        const codm_email = productDetails.codmEmail || productDetails.codm_email || null;
        const codm_password = productDetails.codmPassword || productDetails.codm_password || null;
        const codm_vinculation = productDetails.codmVinculation || productDetails.codm_vinculation || null;
        
        // Cálculo del monto con comisión del 3%
        const feePercentage = 0.03; 
        const amountValue = parseFloat(amount);
        const amountWithFee = amountValue * (1 + feePercentage); 
        
        finalAmountFloat = amountWithFee;
        finalAmountUSD = amountWithFee.toFixed(2);
        
        console.log(`TRAZA 12: Monto final con comisión (3%): ${finalAmountUSD} USD`);
        
        // 🚨 2. INSERCIÓN EN SUPABASE (PENDIENTE)
        
        console.log(`TRAZA 13: Iniciando inserción de orden PENDIENTE a Supabase... Order_Number: ${orderNumber}`);
        
        // Usamos el orderNumber como ID_TRANSACCION inicial; este es el ID que queremos mantener (MALOK-XXXXX).
        const { error: insertError } = await supabase
            .from('transactions')
            .insert([
                {
                    id_transaccion: orderNumber, // ⬅️ ¡Se inserta MALOK-XXXXX!
                    "finalPrice": finalAmountFloat,
                    currency: 'USD', 
                    status: 'pendiente', 
                    email: email,
                    "whatsappNumber": whatsappNumber,
                    
                    paymentMethod: 'plisio', 
                    methodDetails: {}, // Inicialmente vacío
                    
                    // Almacenar el JSON string del carrito
                    "cartDetails": cartDetails, 
                    
                    // Campos de compatibilidad (solo con el primer producto, para retrocompatibilidad)
                    game: game,
                    "playerId": playerId,
                    "packageName": packageName,
                    roblox_email: roblox_email,
                    roblox_password: roblox_password,
                    codm_email: codm_email,
                    codm_password: codm_password,
                    codm_vinculation: codm_vinculation,
                }
            ]);
        
        if (insertError) {
            console.error("TRAZA 13.5: ERROR CRÍTICO al insertar a Supabase:", insertError.message);
            throw new Error(`Fallo al iniciar transacción en Supabase: ${insertError.message}`);
        }
        
        console.log("TRAZA 14: Inserción exitosa en Supabase. Continuando con Plisio...");

        // --- PAYLOAD FINAL PLISIO (Lógica de API) ---
        const payloadData = {
            api_key: apiKey,
            source_currency: 'USD', 
            source_amount: finalAmountUSD, 
            order_name: `Recarga Malok #${orderNumber}`,
            order_number: orderNumber, // Enviamos MALOK-XXXXX como número de orden a Plisio
            allowed_psys_cids: 'USDT_TRX,USDT_BSC', // Sugerencia de monedas
            email: email, 
            callback_url: callbackUrl, 
            success_invoice_url: successUrl, 
        };
        
        const PLISIO_INVOICES_URL = 'https://api.plisio.net/api/v1/invoices/new'; 
        const queryString = new URLSearchParams(payloadData).toString();
        const PLISIO_FINAL_URL = `${PLISIO_INVOICES_URL}?${queryString}`;

        console.log("TRAZA 16: Iniciando solicitud GET a Plisio...");
        
        const response = await axios.get(PLISIO_FINAL_URL);
        const plisioData = response.data;
        console.log(`TRAZA 18: Respuesta de Plisio recibida. Status general: ${plisioData.status}`);

        if (plisioData.status === 'success' && plisioData.data && plisioData.data.invoice_url) {
            
            // 🚨 3. ACTUALIZAR DETALLES: Mantenemos el ID de transacción MALOK-XXXXX
            console.log(`TRAZA 19: Actualizando detalles de Plisio (TXN_ID: ${plisioData.data.txn_id})`);
            
            // NO se actualiza id_transaccion. Se guarda plisioData.data.txn_id en methodDetails.
            await supabase
                .from('transactions')
                .update({ 
                    currency: 'USD',
                    "finalPrice": finalAmountFloat,
                    methodDetails: {
                        plisio_txn_id: plisioData.data.txn_id, // ⬅️ Guardamos el ID de Plisio aquí
                        invoice_id: plisioData.data.invoice_id,
                        address: plisioData.data.wallet_hash,
                        expected_amount: plisioData.data.expected_amount,
                        currency: plisioData.data.currency,
                        psys_cid: plisioData.data.psys_cid
                    }
                })
                .eq('id_transaccion', orderNumber); // Buscamos por el ID MALOK-XXXXX
                
            console.log("--- FINALIZACIÓN EXITOSA DE FUNCIÓN (Factura Creada y BD Actualizada) ---");
            
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chargeUrl: plisioData.data.invoice_url, 
                    // 💡 Enviamos el ID temporal MALOK-XXXXX de vuelta al frontend para el tracking
                    chargeId: orderNumber, 
                }),
            };
        } else {
            // Manejo de error de la API de Plisio
            const errorMessage = plisioData.data && plisioData.data.message ? `Plisio API Error: ${plisioData.data.message}` : 'Error desconocido de la API de Plisio';
            console.error(`TRAZA 20: ERROR: Fallo al crear factura de Plisio. Respuesta de la API no "success": ${errorMessage}`);
            // Usamos un error de ejecución para forzar la limpieza.
            throw new Error(`Fallo de Plisio: ${errorMessage}`);
        }

    } catch (error) {
        // Diagnóstico y limpieza de la fila PENDIENTE en caso de fallo
        
        console.error(`TRAZA 21: ERROR DE CONEXIÓN O EJECUCIÓN: ${error.message}`);
        
        if(supabase && orderNumber) {
            console.warn(`TRAZA 22: Limpieza: Intentando eliminar la fila ${orderNumber} de Supabase debido a un fallo.`);
            // No esperamos la promesa, solo la iniciamos.
            supabase.from('transactions').delete().eq('id_transaccion', orderNumber).then(() => {
                console.log(`TRAZA 22.5: Fila ${orderNumber} eliminada correctamente.`);
            }).catch(cleanError => {
                console.error(`TRAZA 22.6: Fallo al eliminar fila de limpieza: ${cleanError.message}`);
            });
        }
        
        let errorDetails = error.message;
        
        if (error.response) {
            console.error(`TRAZA 23: El error es una respuesta de Axios. Status HTTP: ${error.response.status}`);
            errorDetails = `Error HTTP ${error.response.status}. Ver logs de Netlify para más detalles.`;
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