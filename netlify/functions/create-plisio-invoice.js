// netlify/functions/create-plisio-invoice.js

const axios = require('axios');
const { URLSearchParams } = require('url'); 

exports.handler = async (event, context) => {
    console.log("--- INICIO DE EJECUCIÓN DE FUNCIÓN PLISIO (CORRECCIÓN FINAL DE RUTA) ---");

    if (event.httpMethod !== 'POST') {
        console.log("TRAZA 1: Método HTTP no permitido.");
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    
    // 🔑 1. OBTENER Y LIMPIAR VARIABLES DE ENTORNO
    const apiKey = process.env.PLISIO_API_KEY; 
    const siteUrl = process.env.NETLIFY_SITE_URL;
    
    // CORRECCIÓN CRÍTICA: Eliminar la barra diagonal final de la URL si existe.
    const siteUrlClean = siteUrl.endsWith('/') ? siteUrl.slice(0, -1) : siteUrl;

    const callbackUrl = `${siteUrlClean}/.netlify/functions/plisio-webhook`;
    const successUrl = siteUrlClean; 
    
    console.log(`TRAZA 2: API Key cargada: ${!!apiKey} (true si se cargó)`);
    console.log(`TRAZA 3: Site URL ORIGINAL: ${siteUrl}`);
    console.log(`TRAZA 4: Callback URL para Plisio: ${callbackUrl}`);
    console.log(`TRAZA 5: Success URL para Plisio: ${successUrl}`);


    if (!apiKey || !siteUrl) {
        console.log("TRAZA 6: Error de configuración: Faltan variables de entorno.");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración. Faltan credenciales de Plisio." }) 
        };
    }

    let data;
    try {
        console.log("TRAZA 7: Intentando parsear el cuerpo del evento...");
        data = JSON.parse(event.body);
        console.log(`TRAZA 8: Datos de entrada parseados. Monto recibido: ${data.amount}`);
    } catch (parseError) {
        console.log(`TRAZA 9: ERROR de parseo JSON: ${parseError.message}`);
        return { statusCode: 400, body: JSON.stringify({ message: 'Formato de cuerpo de solicitud inválido.' }) };
    }
    
    // 🎯 CONFIGURACIÓN: Usando BTC para la prueba de descarte.
    const acceptedCurrencies = 'BTC'; 
    
    // 💡 CORRECCIÓN DE SCOPE: Declaramos la variable aquí.
    let finalAmountUSD = '0.00'; 
    
    try {
        const { amount, email, whatsapp, cartDetails } = data; 
        console.log(`TRAZA 10: Datos de entrada: Email=${email}, Monto=${amount}`);

        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0 || !email) {
            console.log("TRAZA 11: Datos de transacción incompletos o inválidos (Validación fallida).");
            return { statusCode: 400, body: JSON.stringify({ message: 'Datos de transacción incompletos o inválidos.' }) };
        }
        
        const feePercentage = 0.03; 
        const amountValue = parseFloat(amount);
        const amountWithFee = amountValue * (1 + feePercentage); 
        
        // 💡 CORRECCIÓN DE SCOPE: Asignamos el valor.
        finalAmountUSD = amountWithFee.toFixed(2);
        
        console.log(`TRAZA 12: Monto final con comisión (${feePercentage * 100}%): ${finalAmountUSD} USD`);
        
        // --- PAYLOAD COMO OBJETO (FÁCIL DE LEER) ---
        const payloadData = {
            // ✅ Comando que define la acción, correctamente en el cuerpo (Body).
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
        
        // 🚀 CORRECCIÓN CLAVE: Usamos la URL sin el slash final, asumiendo que es el endpoint base.
        const PLISIO_INVOICE_URL = 'https://plisio.net/api/v1/invoices'; 

        console.log("TRAZA 13: Payload FINAL a enviar a Plisio (sin la API Key):");
        // Logueamos el payload excepto la clave
        const { api_key, ...safePayload } = payloadData;
        console.log(JSON.stringify(safePayload));
        
        console.log("TRAZA 14: Iniciando solicitud POST a Plisio...");
        
        // 💡 USAMOS transformRequest para garantizar el formato x-www-form-urlencoded
        const response = await axios.post(PLISIO_INVOICE_URL, payloadData, { 
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded' 
            },
            transformRequest: [(data, headers) => {
                const urlEncodedData = new URLSearchParams(data).toString();
                console.log(`TRAZA 15: Datos transformados (URL-encoded): ${urlEncodedData}`);
                return urlEncodedData;
            }],
        });
        
        const plisioData = response.data;
        console.log(`TRAZA 16: Respuesta de Plisio recibida. Status general: ${plisioData.status}`);
        console.log(`TRAZA 17: Datos COMPLETO de Plisio:`, JSON.stringify(plisioData)); // Loguea todo el JSON

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
            // Manejo de error de la API de Plisio que regresa un JSON de error (status 'error')
            const errorMessage = plisioData.data && plisioData.data.message ? `Plisio API Error: ${plisioData.data.message}` : 'Error desconocido de la API de Plisio';
            console.error(`TRAZA 18: ERROR: Fallo al crear factura de Plisio. Respuesta de la API no "ok": ${errorMessage}`);
            // Loguear el error para saber qué mensaje envía Plisio
            if (plisioData.data && plisioData.data.errors) {
                console.error("TRAZA 18.1: Errores detallados de Plisio:", JSON.stringify(plisioData.data.errors));
            }
            
            // Forzamos un error para entrar al catch y loguear el 500
            throw new Error(errorMessage); 
        }

    } catch (error) {
        // En caso de error de conexión o un error "throw" en el bloque try
        console.error(`TRAZA 19: ERROR DE CONEXIÓN O EJECUCIÓN: ${error.message}`);
        
        let errorDetails = error.message;
        
        // --- DIAGNÓSTICO CLAVE DE AXIOS ---
        if (error.response) {
            console.error(`TRAZA 20: El error es una respuesta de Axios. Status HTTP: ${error.response.status}`);
            console.error(`TRAZA 21: Cuerpo de la RESPUESTA de ERROR (HTML/Texto/JSON):`);
            // ¡Esto es lo que necesitamos! El cuerpo del error 500 (o 4xx) de Plisio
            console.error(error.response.data); 
            
            if (error.response.status === 500) {
                 errorDetails = `Plisio Status 500. Error probable: **API Key incorrecta/revocada** o **URL de API inválida**. Revise TRAZA 21.`;
            } else if (error.response.status === 401 || error.response.status === 403) {
                 errorDetails = `Plisio Status ${error.response.status}. Error de **Autenticación/Permisos**. Confirme que la API Key es correcta.`;
            }
            
        } else if (error.request) {
            // El request fue enviado, pero no hubo respuesta (ej: timeout o fallo de red)
            console.error("TRAZA 20: No se recibió respuesta. Posible fallo de red o timeout.");
            errorDetails = `Fallo de red o timeout al conectar con Plisio.`;
        } else {
            // Error en la configuración de la solicitud o el throw manual
            console.error("TRAZA 20: Error en la configuración de Axios o error interno de la función.");
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