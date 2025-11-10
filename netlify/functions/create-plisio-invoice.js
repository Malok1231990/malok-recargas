// netlify/functions/create-plisio-invoice.js
const axios = require('axios');
const { URLSearchParams } = require('url'); 
// 🚨 Importar el cliente de Supabase
const { createClient } = require('@supabase/supabase-js');

// 💡 Se elimina safeText, se usará || null para los campos opcionales

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
    const orderNumber = `MALOK-${Date.now()}`; // Número único de orden inicial (ID_TRANSACCION)

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
                const cartArray = JSON.parse(cartDetails);
                productDetails = cartArray.length > 0 ? cartArray[0] : {};
            } catch (e) {
                console.error("TRAZA 11.5: Error al parsear cartDetails, usando objeto vacío.", e.message);
            }
        }
        
        // Mapeo de datos para la base de datos:
        // Los campos de texto principal (game, packageName) usan '||' para valores por defecto.
        const game = productDetails.game || 'Carrito Múltiple';
        const playerId = productDetails.playerId || null; // 💡 Usar || null para coincidir con manual (si está ausente, será null)
        const packageName = productDetails.packageName || 'Múltiples Paquetes';
        const whatsappNumber = whatsapp || null; // 💡 Usar || null
        
        // Mapeo de credenciales: 💡 Usar || null para COINCIDIR con la inserción manual
        const roblox_email = productDetails.robloxEmail || productDetails.roblox_email || null;
        const roblox_password = productDetails.robloxPassword || productDetails.roblox_password || null;
        const codm_email = productDetails.codmEmail || productDetails.codm_email || null;
        const codm_password = productDetails.codmPassword || productDetails.codm_password || null;
        const codm_vinculation = productDetails.codmVinculation || productDetails.codm_vinculation || null;
        
        // Cálculo del monto
        const feePercentage = 0.03; 
        const amountValue = parseFloat(amount);
        const amountWithFee = amountValue * (1 + feePercentage); 
        
        finalAmountFloat = amountWithFee;
        finalAmountUSD = amountWithFee.toFixed(2);
        
        console.log(`TRAZA 12: Monto final con comisión (3%): ${finalAmountUSD} USD`);
        
        // 🚨 2. INSERCIÓN EN SUPABASE (PENDIENTE)
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        
        console.log(`TRAZA 13: Iniciando inserción de orden PENDIENTE a Supabase... Order_Number: ${orderNumber}`);
        
        const { data: insertedData, error: insertError } = await supabase
            .from('transactions')
            .insert([
                {
                    id_transaccion: orderNumber,
                    "finalPrice": finalAmountFloat,
                    currency: 'USD', 
                    // 💡 CORRECCIÓN: Estado en minúscula para consistencia con process-payment.js
                    status: 'pendiente', 
                    email: email,
                    "whatsappNumber": whatsappNumber,
                    
                    // 💡 CONSISTENCIA: Insertar campos de método y detalles
                    paymentMethod: 'plisio', 
                    methodDetails: {}, // Inicialmente vacío
                    
                    // Campos del producto (tomados del primer ítem)
                    game: game,
                    "playerId": playerId,
                    "packageName": packageName,
                    roblox_email: roblox_email, // ⬅️ Ahora será null si está ausente
                    roblox_password: roblox_password, // ⬅️ Ahora será null si está ausente
                    codm_email: codm_email, // ⬅️ Ahora será null si está ausente
                    codm_password: codm_password, // ⬅️ Ahora será null si está ausente
                    codm_vinculation: codm_vinculation, // ⬅️ Ahora será null si está ausente
                }
            ])
            .select();
        
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
            order_name: "Recarga de Servicios Malok",
            order_number: orderNumber,
            allowed_psys_cids: 'USDT_TRX,USDT_BSC', 
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
            
            // 🚨 3. ACTUALIZAR ID DE TRANSACCIÓN REAL DE PLISIO
            console.log(`TRAZA 19: Actualizando ID de Transacción de Plisio: ${plisioData.data.txn_id}`);
            await supabase
                .from('transactions')
                .update({ 
                    id_transaccion: plisioData.data.txn_id,
                    currency: 'USD',
                    "finalPrice": finalAmountFloat,
                    // 💡 CONSISTENCIA: Actualizar methodDetails con los datos de Plisio
                    methodDetails: {
                        invoice_id: plisioData.data.invoice_id,
                        address: plisioData.data.wallet_hash,
                        expected_amount: plisioData.data.expected_amount,
                        currency: plisioData.data.currency,
                        psys_cid: plisioData.data.psys_cid
                    }
                })
                .eq('id_transaccion', orderNumber);
                
            console.log("--- FINALIZACIÓN EXITOSA DE FUNCIÓN (Factura Creada y BD Actualizada) ---");
            
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chargeUrl: plisioData.data.invoice_url, 
                    chargeId: plisioData.data.txn_id, 
                }),
            };
        } else {
            // Manejo de error de la API de Plisio
            const errorMessage = plisioData.data && plisioData.data.message ? `Plisio API Error: ${plisioData.data.message}` : 'Error desconocido de la API de Plisio';
            console.error(`TRAZA 20: ERROR: Fallo al crear factura de Plisio. Respuesta de la API no "success": ${errorMessage}`);
            throw new Error(errorMessage);
        }

    } catch (error) {
        // Diagnóstico y limpieza de la fila PENDIENTE en caso de fallo
        // ... (el código de manejo de errores y limpieza se mantiene igual)
        
        console.error(`TRAZA 21: ERROR DE CONEXIÓN O EJECUCIÓN: ${error.message}`);
        
        if(supabase && orderNumber) {
            console.warn(`TRAZA 22: Limpieza: Intentando eliminar la fila ${orderNumber} de Supabase debido a un fallo.`);
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