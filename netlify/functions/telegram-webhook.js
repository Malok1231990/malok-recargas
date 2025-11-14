// netlify/functions/telegram-webhook.js
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

exports.handler = async (event, context) => {
    if (event.httpMethod !== "POST") {
        console.log("Method Not Allowed: Expected POST.");
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // --- Variables de Entorno y Cliente Supabase ---
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !TELEGRAM_BOT_TOKEN) {
        console.error("FATAL ERROR: Faltan variables de entorno esenciales.");
        return { statusCode: 500, body: "Error de configuración." };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const body = JSON.parse(event.body);

    // ----------------------------------------------------------------------
    // 🔑 PASO 1: OBTENER LA TASA DE CAMBIO DINÁMICA
    // ----------------------------------------------------------------------
    let EXCHANGE_RATE = 1.0; // Valor por defecto (si es USD o si falla la DB)
    
    try {
        const { data: configData, error: configError } = await supabase
            .from('configuracion_sitio')
            .select('tasa_dolar')
            .eq('id', 1) // Asumimos que la configuración está en el ID 1
            .maybeSingle();

        if (configError) {
            console.warn(`WARN DB: Fallo al obtener tasa de dólar. Usando tasa por defecto (1.0). Mensaje: ${configError.message}`);
        } else if (configData && configData.tasa_dolar > 0) {
            EXCHANGE_RATE = configData.tasa_dolar;
            console.log(`LOG: Tasa de dólar obtenida de DB: ${EXCHANGE_RATE}`);
        }
    } catch (e) {
        console.error("ERROR CRITICO al obtener configuración de DB:", e.message);
    }


    // ----------------------------------------------------------------------
    // 💡 LÓGICA CLAVE: Manejo de la consulta de Callback
    // ----------------------------------------------------------------------
    if (body.callback_query) {
        const callbackData = body.callback_query.data;
        const chatId = body.callback_query.message.chat.id;
        const messageId = body.callback_query.message.message_id;
        const originalText = body.callback_query.message.text;
        const transactionPrefix = 'mark_done_';
        
        if (callbackData.startsWith(transactionPrefix)) {
            const transactionId = callbackData.replace(transactionPrefix, '');
            const NEW_STATUS = 'REALIZADA'; 
            
            console.log(`LOG: Callback recibido: Intentando marcar transacción ${transactionId} como ${NEW_STATUS}.`);

            try {
                // 2. BUSCAR LA TRANSACCIÓN
                console.log(`LOG: Buscando datos para transacción ${transactionId} en tabla 'transactions'.`);
                // ⭐️ INICIO DE LA MODIFICACIÓN CLAVE EN telegram-webhook.js ⭐️
                // Incluimos base_amount en la selección de columnas
                const { data: transactionData, error: fetchError } = await supabase
                    .from('transactions')
                    .select('status, google_id, "finalPrice", base_amount, currency, game')
                    .eq('id_transaccion', transactionId)
                    .maybeSingle();
                // ⭐️ FIN DE LA MODIFICACIÓN CLAVE ⭐️

                if (fetchError || !transactionData) {
                    console.error(`ERROR DB: Fallo al buscar la transacción ${transactionId}.`, fetchError ? fetchError.message : 'No encontrada');
                    // Usando sendTelegramAlert (que usa 'HTML' ahora)
                    await sendTelegramAlert(TELEGRAM_BOT_TOKEN, chatId, `❌ <b>Error:</b> No se encontró la transacción ${transactionId}.`, messageId);
                    return { statusCode: 200, body: "Processed" };
                }

                const { 
                    status: currentStatus, 
                    google_id, 
                    "finalPrice": finalPrice, 
                    base_amount, // <-- Nuevo campo
                    currency,
                    game 
                } = transactionData;
                
                const IS_WALLET_RECHARGE = game === 'Recarga de Saldo';

                // ⭐️ INICIO DE LA MODIFICACIÓN CLAVE EN telegram-webhook.js ⭐️
                // Determinar el monto a inyectar: base_amount si existe y es recarga, sino finalPrice.
                const amountInTransactionCurrency = IS_WALLET_RECHARGE && base_amount !== null ? parseFloat(base_amount) : parseFloat(finalPrice);
                // ⭐️ FIN DE LA MODIFICACIÓN CLAVE ⭐️
                let amountToInject = amountInTransactionCurrency;
                let injectionMessage = ""; 
                let updateDBSuccess = true; // Flag para rastrear el éxito de la inyección/actualización


                // -------------------------------------------------------------
                // 3. LÓGICA DE INYECCIÓN CONDICIONAL
                // -------------------------------------------------------------
                
                if (currentStatus === NEW_STATUS) {
                    // Usa etiquetas HTML <b> y <i>
                    injectionMessage = "\n\n⚠️ <b>NOTA:</b> La transacción ya estaba en estado 'REALIZADA'. El saldo no fue inyectado de nuevo.";
                } else {
                    
                    if (IS_WALLET_RECHARGE) { 

                        // PASO 3.1: LÓGICA CONDICIONAL DE CONVERSIÓN
                        if (currency === 'VES' || currency === 'BS') { 
                            if (EXCHANGE_RATE > 0) {
                                amountToInject = amountInTransactionCurrency / EXCHANGE_RATE;
                                console.log(`LOG: Moneda VES detectada. Convirtiendo ${amountInTransactionCurrency.toFixed(2)} VES a USD con tasa ${EXCHANGE_RATE}. Resultado: $${amountToInject.toFixed(2)} USD.`);
                            } else {
                                throw new Error("ERROR FATAL: El tipo de cambio (tasa_dolar) no es válido o es cero. No se puede convertir VES a USD.");
                            }
                        } 

                        // PASO 3.2: INYECCIÓN DE SALDO
                        if (!google_id || isNaN(amountToInject) || amountToInject <= 0) {
                            // Usamos amountInTransactionCurrency para el mensaje para mostrar el valor usado (base_amount o finalPrice)
                            injectionMessage = `\n\n❌ <b>ERROR DE INYECCIÓN DE SALDO:</b> Datos incompletos (Google ID: ${google_id}, Monto Usado: ${amountInTransactionCurrency}). <b>¡REVISIÓN MANUAL REQUERIDA!</b>`;
                            updateDBSuccess = false;
                        } else {
                            // 4. INYECTAR SALDO AL CLIENTE (Usando la función RPC)
                            console.log(`LOG: Intentando inyectar $${amountToInject.toFixed(2)} a 'user_id' ${google_id} usando RPC.`);
                            
                            try {
                                const { error: balanceUpdateError } = await supabase
                                    .rpc('incrementar_saldo', { 
                                        p_user_id: google_id, 
                                        p_monto: amountToInject.toFixed(2)
                                    }); 
                                    
                                if (balanceUpdateError) {
                                    console.error(`ERROR DB: Fallo al inyectar saldo a ${google_id}. Mensaje: ${balanceUpdateError.message}.`);
                                    injectionMessage = `\n\n❌ <b>ERROR CRÍTICO AL INYECTAR SALDO:</b> No se pudo actualizar la billetera del cliente (<code>${google_id}</code>). <br/>${balanceUpdateError.message}`;
                                    updateDBSuccess = false; // El flag falla si la inyección falla
                                    throw new Error("Fallo en la inyección de saldo.");
                                }
                                
                                console.log(`LOG: Inyección de saldo exitosa para ${google_id}.`);
                                // Usa etiquetas HTML <b> y <code>
                                injectionMessage = `\n\n💰 <b>INYECCIÓN DE SALDO EXITOSA:</b> Se inyectaron <b>$${amountToInject.toFixed(2)} USD</b> a la billetera del cliente (<code>${google_id}</code>).`;
                            } catch (e) {
                                console.error("ERROR CRITICO: Falló la llamada RPC para inyección de saldo.", e.message);
                                updateDBSuccess = false;
                                throw new Error(`Falló la inyección atómica (RPC). Error: ${e.message}`); // Propaga el error
                            }
                        }
                    } else {
                        // Si NO es 'Recarga de Saldo' (es un producto)
                        injectionMessage = `\n\n🛒 <b>PRODUCTO ENTREGADO ✅: No se requería inyección de saldo.</b>`;
                    }
                } 


                // 5. ACTUALIZACIÓN DEL ESTADO... (Solo si la inyección y el estado inicial fueron exitosos)
                if (currentStatus !== NEW_STATUS && updateDBSuccess) {
                    console.log(`LOG: Actualizando estado de transacción ${transactionId} a ${NEW_STATUS}.`);
                    const { error: updateError } = await supabase
                        .from('transactions')
                        .update({ 
                            status: NEW_STATUS
                        })
                        .eq('id_transaccion', transactionId)
                        .in('status', ['pendiente', 'CONFIRMADO']); 
                    
                    if (updateError) {
                        console.error(`ERROR DB: Fallo al actualizar el estado a ${NEW_STATUS}.`, updateError.message);
                        injectionMessage += `\n\n⚠️ <b>ADVERTENCIA:</b> Fallo al actualizar el estado de la transacción: ${updateError.message}`;
                        updateDBSuccess = false; // Si falla la actualización, cambiamos el flag para el mensaje final
                    }
                }
                
                // Si ya estaba REALIZADA, aún se considera un éxito en el marcado
                const finalStatusText = (currentStatus === NEW_STATUS || updateDBSuccess) ? NEW_STATUS : 'ERROR CRÍTICO';
                const finalStatusEmoji = (currentStatus === NEW_STATUS || updateDBSuccess) ? '✅' : '❌';


                // 6. CONFIRMACIÓN Y EDICIÓN DEL MENSAJE DE TELEGRAM... (Aislado del error de la DB)
                console.log("LOG: Editando mensaje de Telegram.");
                
                // Usamos etiquetas HTML <b> y <i>
                const statusMarker = `\n\n------------------------------------------------\n` +
                                     `${finalStatusEmoji} <b>ESTADO FINAL: ${finalStatusText}</b>\n` +
                                     `<i>Marcada por operador a las: ${new Date().toLocaleTimeString('es-VE')}</i> \n` +
                                     `------------------------------------------------` +
                                     injectionMessage; 

                const newFullText = originalText + statusMarker;
                
                await editTelegramMessage(
                    TELEGRAM_BOT_TOKEN, chatId, messageId, 
                    newFullText, 
                    {}
                );
                
            } catch (e) {
                // Este 'catch' solo atrapa errores graves como fallo en la búsqueda o en la inyección (RPC)
                console.error("ERROR FATAL en callback_query handler (Catch block):", e.message);
                await editTelegramMessage(
                    TELEGRAM_BOT_TOKEN, chatId, messageId, 
                    // Usamos etiquetas HTML <b> y <code>
                    `❌ <b>ERROR CRÍTICO EN PROCESO DE MARCADO</b> ❌<br/>Transacción: <code>${transactionId}</code><br/>Fallo: ${e.message}<br/><br/><b>¡REVISIÓN MANUAL URGENTE!</b>`,
                    {}
                );
            }
        }
    } 
    
    // ... (Resto del código) ...
    return { statusCode: 200, body: "Webhook processed" };
};

// --- Funciones Auxiliares para Telegram (MODIFICADAS para usar HTML) ---

// MODIFICADA: Ahora usa parse_mode: 'HTML'
async function editTelegramMessage(token, chatId, messageId, text, replyMarkup) {
    const telegramApiUrl = `https://api.telegram.org/bot${token}/editMessageText`;
    try {
        await axios.post(telegramApiUrl, {
            chat_id: chatId,
            message_id: messageId,
            text: text,
            parse_mode: 'HTML', // <-- ¡CAMBIO!
            reply_markup: replyMarkup
        });
    } catch (error) {
        // Este manejo interno previene que un error de Telegram se propague y detenga la función principal
        console.error("ERROR TELEGRAM: Fallo al editar mensaje de Telegram.", error.response ? error.response.data : error.message);
    }
}

// MODIFICADA: Ahora usa parse_mode: 'HTML'
async function sendTelegramAlert(token, chatId, text, replyToMessageId = null) {
    const telegramApiUrl = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
        await axios.post(telegramApiUrl, {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML', // <-- ¡CAMBIO!
            reply_to_message_id: replyToMessageId 
        });
    } catch (error) {
        console.error("ERROR TELEGRAM: Fallo al enviar alerta de Telegram.", error.response ? error.response.data : error.message);
    }
}