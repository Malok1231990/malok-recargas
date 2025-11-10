// netlify/functions/create-plisio-invoice.js
const axios = require('axios');
const { URLSearchParams } = require('url'); 
// 🚨 Importar el cliente de Supabase
const { createClient } = require('@supabase/supabase-js');


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
    // Nota: success_url no necesita todos los parámetros, el webhook se encarga de la confirmación
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
    const orderNumber = `MALOK-${Date.now()}`; // Número único de orden para Plisio

    try {
        // Obtener datos del formulario que vienen del frontend
        const { amount, email, game, playerId, packageName, whatsappNumber, roblox_email, roblox_password, codm_email, codm_password, codm_vinculation } = data; 
        
        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0 || !email) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Datos de transacción incompletos o inválidos.' }) };
        }
        
        const feePercentage = 0.03; 
        const amountValue = parseFloat(amount);
        const amountWithFee = amountValue * (1 + feePercentage); 
        
        finalAmountUSD = amountWithFee.toFixed(2);
        
        console.log(`TRAZA 12: Monto final con comisión (3%): ${finalAmountUSD} USD`);
        
        // 🚨 2. INSERCIÓN EN SUPABASE (PENDIENTE)
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        
        console.log(`TRAZA 13: Iniciando inserción de orden PENDIENTE a Supabase... Order_Number: ${orderNumber}`);
        
        // Usamos el orderNumber como ID_TRANSACCION inicial; el Webhook usará esto para encontrar la fila.
        const { data: insertedData, error: insertError } = await supabase
            .from('transactions')
            .insert([
                {
                    id_transaccion: orderNumber, // Usamos el order_number como ID_TRANSACCION inicial
                    "finalPrice": finalAmountUSD,
                    status: 'PENDIENTE',
                    email: email,
                    game: game,
                    "playerId": playerId,
                    "packageName": packageName,
                    "whatsappNumber": whatsappNumber,
                    roblox_email: roblox_email,
                    roblox_password: roblox_password,
                    codm_email: codm_email,
                    codm_password: codm_password,
                    codm_vinculation: codm_vinculation,
                }
            ])
            .select();
        
        if (insertError) {
            console.error("TRAZA 13.5: ERROR CRÍTICO al insertar a Supabase:", insertError.message);
            throw new Error(`Fallo al iniciar transacción en Supabase: ${insertError.message}`);
        }
        
        console.log("TRAZA 14: Inserción exitosa en Supabase. Continuando con Plisio...");

        // --- PAYLOAD FINAL PLISIO ---
        const payloadData = {
            api_key: apiKey,
            source_currency: 'USD', 
            source_amount: finalAmountUSD,
            order_name: "Recarga de Servicios Malok",
            order_number: orderNumber, // Enviamos el order_number a Plisio
            
            allowed_psys_cids: 'USDT_TRX,USDT_BSC', 
            
            email: email, 
            callback_url: callbackUrl, 
            success_invoice_url: successUrl, 
        };
        // ----------------------------------------------------
        
        const PLISIO_INVOICES_URL = 'https://api.plisio.net/api/v1/invoices/new'; 
        
        const queryString = new URLSearchParams(payloadData).toString();
        
        const PLISIO_FINAL_URL = `${PLISIO_INVOICES_URL}?${queryString}`;


        console.log("TRAZA 16: Iniciando solicitud GET a Plisio...");
        
        const response = await axios.get(PLISIO_FINAL_URL);
        
        const plisioData = response.data;
        console.log(`TRAZA 18: Respuesta de Plisio recibida. Status general: ${plisioData.status}`);

        if (plisioData.status === 'success' && plisioData.data && plisioData.data.invoice_url) {
            
            // 🚨 3. ACTUALIZAR ID DE TRANSACCIÓN REAL DE PLISIO
            // Plisio devuelve su propio TXN_ID. Lo guardamos en la fila que acabamos de crear.
            console.log(`TRAZA 19: Actualizando ID de Transacción de Plisio: ${plisioData.data.txn_id}`);
            await supabase
                .from('transactions')
                .update({ 
                    id_transaccion: plisioData.data.txn_id, 
                    currency: 'USD',
                    "finalPrice": finalAmountUSD // Nos aseguramos de guardar el precio final
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
            // Manejo de error de la API de Plisio que regresa un JSON de error
            const errorMessage = plisioData.data && plisioData.data.message ? `Plisio API Error: ${plisioData.data.message}` : 'Error desconocido de la API de Plisio';
            console.error(`TRAZA 20: ERROR: Fallo al crear factura de Plisio. Respuesta de la API no "success": ${errorMessage}`);
            throw new Error(errorMessage);
        }

    } catch (error) {
        // Diagnóstico para errores de conexión o ejecución
        console.error(`TRAZA 21: ERROR DE CONEXIÓN O EJECUCIÓN: ${error.message}`);
        
        // 🚨 CRÍTICO: Si falló después de la inserción, debemos eliminar la fila PENDIENTE para evitar basura
        if(supabase && orderNumber) {
            console.warn(`TRAZA 22: Limpieza: Intentando eliminar la fila ${orderNumber} de Supabase debido a un fallo.`);
            // No esperamos la respuesta de eliminación para no bloquear el flujo de error
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