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

    // CORRECCIÓN CRÍTICA: Eliminar la barra diagonal final de la URL si existe.
    const siteUrlClean = siteUrl.endsWith('/') ? siteUrl.slice(0, -1) : siteUrl;

    const callbackUrl = `${siteUrlClean}/.netlify/functions/plisio-webhook`;
    const successUrl = siteUrlClean; 
    const cancelUrl = siteUrlClean;
    
    // 2. CONFIGURACIÓN INICIAL Y PARSEO DE DATOS
    if (!apiKey || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        console.error("TRAZA 1: Faltan credenciales de Plisio o Supabase.");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración del servidor. Contacte al administrador." }) 
        };
    }
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    
    let orderData;
    try {
        orderData = JSON.parse(event.body);
    } catch (e) {
        console.error("TRAZA 2: Error al parsear JSON del cuerpo de la solicitud:", e.message);
        return { statusCode: 400, body: JSON.stringify({ message: "Formato de solicitud inválido." }) };
    }
    
    console.log("TRAZA 3: Datos de la orden recibidos:", orderData);
    
    // 3. EXTRACCIÓN DE DATOS DE LA ORDEN
    const { 
        userData, 
        cartItems, 
        totalAmountUSD, 
        totalAmountVES, 
        acceptedCurrencies, 
        currency, // 'USD'
        orderNumber,
        email,
        description,
        cartDetails
    } = orderData;
    
    if (!userData || !cartItems || !totalAmountUSD || !orderNumber || !email || !acceptedCurrencies || !currency) {
         console.error("TRAZA 4: Faltan campos esenciales en el cuerpo de la solicitud.");
         return { statusCode: 400, body: JSON.stringify({ message: "Faltan datos de la orden." }) };
    }
    
    // 4. CONSTRUIR REGISTRO DE TRANSACCIÓN PARA SUPABASE (PENDIENTE)
    const transactionRecord = {
        id_transaccion: orderNumber,
        user_id: userData.id,
        email: email,
        monto_usd: totalAmountUSD,
        monto_ves: totalAmountVES,
        metodo_pago: 'plisio', // Método de pago fijo para esta función
        estado: 'pendiente', // Estado inicial
        monedas_aceptadas: acceptedCurrencies.join(','),
        detalles_carrito: cartDetails,
        fecha_creacion: new Date().toISOString()
    };
    
    // 5. INSERTAR LA TRANSACCIÓN EN SUPABASE CON ESTADO 'PENDIENTE'
    try {
        console.log(`TRAZA 5: Insertando transacción pendiente ${orderNumber} en Supabase...`);
        const { error: insertError } = await supabase
            .from('transactions')
            .insert([transactionRecord]);
            
        if (insertError) {
            console.error("TRAZA 6: Error de Supabase al insertar transacción:", insertError.message);
            throw new Error(`Error de DB al registrar la orden: ${insertError.message}`);
        }
        console.log(`TRAZA 7: Transacción ${orderNumber} insertada como pendiente.`);
        
    } catch (dbError) {
        console.error(`TRAZA 8: Fallo CRÍTICO de Supabase: ${dbError.message}`);
         return { statusCode: 500, body: JSON.stringify({ message: `Error interno al registrar la orden: ${dbError.message}` }) };
    }


    // 6. CONSTRUIR PAYLOAD PARA PLISIO (CON COMAS CORREGIDAS)
    const plisioPayload = {
        api_key: apiKey, // COMA AÑADIDA
        order_number: orderNumber, // COMA AÑADIDA
        amount: totalAmountUSD, // COMA AÑADIDA
        currency: currency, // COMA AÑADIDA
        source_currency: currency, // COMA AÑADIDA
        email: email, // COMA AÑADIDA
        description: description, // COMA AÑADIDA
        callback_url: callbackUrl, // COMA AÑADIDA
        success_url: successUrl, // COMA AÑADIDA
        cancel_url: cancelUrl, // COMA AÑADIDA
        // CLAVE CORREGIDA: Usamos 'allowed_currencies' y añadimos la coma
        allowed_currencies: acceptedCurrencies.join(','), 
        customer_name: userData.nombre, // COMA AÑADIDA
        customer_email: userData.email, // COMA AÑADIDA
        customer_notes: cartDetails, // COMA AÑADIDA
        expire_mins: 60, // COMA AÑADIDA
        custom: JSON.stringify({ userId: userData.id }), // COMA AÑADIDA
    };

    // 7. HACER LA LLAMADA A LA API DE PLISIO
    try {
        console.log("TRAZA 10: Llamando a la API de Plisio...");
        
        // 🚨 Plisio espera los datos como x-www-form-urlencoded, no JSON
        const params = new URLSearchParams(plisioPayload).toString(); 
        
        const response = await axios.post(
            'https://plisio.net/api/v1/invoices/new', 
            params, 
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        const plisioResponse = response.data;
        
        console.log("TRAZA 11: Respuesta de Plisio recibida.");

        // 8. VERIFICAR RESPUESTA DE PLISIO
        if (plisioResponse.status !== 'success') {
            const errorMessage = plisioResponse.data && plisioResponse.data.message ? plisioResponse.data.message : 'Fallo desconocido de Plisio';
            console.error(`TRAZA 12: Fallo al crear factura de Plisio (Respuesta JSON): ${errorMessage}`);
            // No se borra la transacción pendiente en este caso, se deja para revisión manual
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: `Error de la pasarela de pago: ${errorMessage}` }),
            };
        }
        
        // 9. EXTRAER URL DE PAGO Y DEVOLVER AL CLIENTE
        const paymentUrl = plisioResponse.data.url;
        console.log("TRAZA 13: Factura creada. URL de pago generada.");
        
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                paymentUrl: paymentUrl,
                invoiceId: plisioResponse.data.txn_id, // Usar el ID de Plisio
            }),
        };

    } catch (error) {
        // Manejo de errores de Axios o ejecución general
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
        } else if (error.request) {
            console.error("TRAZA 24: No se recibió respuesta de Plisio (Problema de red).");
            errorDetails = `Error de conexión: ${error.message}`;
        }
        
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: `Error interno del servidor: ${errorDetails}` }),
        };
    }
};