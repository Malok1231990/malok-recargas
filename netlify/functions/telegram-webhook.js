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
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        console.error("ERROR: No se pudo parsear el cuerpo de la solicitud JSON.", e.message);
        return { statusCode: 400, body: "Invalid JSON body" };
    }

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
                // 🔑 MODIFICADO: AÑADIDA COLUMNA 'base_amount'
                console.log(`LOG: Buscando datos para transacción ${transactionId} en tabla 'transactions'.`);
                const { data: transactionData, error: fetchError } = await supabase
                    .from('transactions')
                    .select('status, google_id, "finalPrice", currency, game, base_amount') 
                    .eq('id_transaccion', transactionId)
                    .maybeSingle();

                if (fetchError || !transactionData) {
                    console.error(`ERROR DB: Fallo al buscar la transacción ${transactionId}.`, fetchError ? fetchError.message : 'No encontrada');
                    await sendTelegramAlert(TELEGRAM_BOT_TOKEN, chatId, `❌ Error: No se encontró la transacción ${transactionId}.`, messageId);
                    return { statusCode: 200, body: "Processed" };
                }

                const { 
                    status: currentStatus, 
                    google_id, 
                    "finalPrice": finalPrice, 
                    currency,
                    game,
                    base_amount // ⬅️ OBTENEMOS EL MONTO BASE
                } = transactionData;
                
                // 🔑 CLAVE: Determinar si la transacción es una recarga de saldo
                const IS_WALLET_RECHARGE = game === 'Recarga de Saldo';

                const amountInTransactionCurrency = parseFloat(finalPrice);
                
                // 🔑 PRIORIDAD: Usar base_amount si existe. Si no, usar finalPrice.
                let amountToInject = base_amount ? parseFloat(base_amount) : amountInTransactionCurrency; 
                let injectionMessage = ""; 

                // -------------------------------------------------------------
                // LÓGICA DE INYECCIÓN CONDICIONAL
                // -------------------------------------------------------------
                
                // 3. Verificar si ya fue realizada...
                if (currentStatus === NEW_STATUS) {
                    injectionMessage = "\n\n⚠️ **NOTA:** La transacción ya estaba en estado 'REALIZADA'. El saldo no fue inyectado de nuevo.";
                } else {
                    
                    if (IS_WALLET_RECHARGE) { // SOLO si es 'Recarga de Saldo'

                        // PASO 3.1: LÓGICA CONDICIONAL DE CONVERSIÓN (Solo si es recarga manual VES)
                        // Esta conversión solo es necesaria si *no* había base_amount y la moneda es VES
                        if (!base_amount && (currency === 'VES' || currency === 'BS')) { 
                            if (EXCHANGE_RATE > 0) {
                                amountToInject = amountInTransactionCurrency / EXCHANGE_RATE;
                                console.log(`LOG: Moneda VES detectada sin base_amount. Convirtiendo ${amountInTransactionCurrency.toFixed(2)} VES a USD con tasa ${EXCHANGE_RATE}. Resultado: $${amountToInject.toFixed(2)} USD.`);
                            } else {
                                // Error crítico si la tasa es 0 o no se pudo obtener
                                throw new Error("ERROR FATAL: El tipo de cambio (tasa_dolar) no es válido o es cero. No se puede convertir VES a USD.");
                            }
                        } else if (currency !== 'USD' && !base_amount) {
                            console.warn(`WARN: Moneda desconocida '${currency}' y sin base_amount. Inyectando monto final sin conversión: $${amountToInject.toFixed(2)}.`);
                        }

                        // PASO 3.2: INYECCIÓN DE SALDO
                        if (!google_id || isNaN(amountToInject) || amountToInject <= 0) {
                            // Validaciones básicas para inyección
                            injectionMessage = `\n\n❌ **ERROR DE INYECCIÓN DE SALDO:** Datos incompletos (Google ID: ${google_id}, Monto: ${finalPrice}). **¡REVISIÓN MANUAL REQUERIDA!**`;
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
                                    injectionMessage = `\n\n❌ **ERROR CRÍTICO AL INYECTAR SALDO:** No se pudo actualizar la billetera del cliente (${google_id}). \n\n${balanceUpdateError.message}`;
                                    throw new Error("Fallo en la inyección de saldo.");
                                }
                                
                                console.log(`LOG: Inyección de saldo exitosa para ${google_id}.`);
                                // 🔑 MENSAJE MEJORADO: Indica que el monto es el base si es Plisio
                                const montoReportado = base_amount ? `$${amountToInject.toFixed(2)} USD (Monto Base, excluyendo comisión)` : `${finalPrice} ${currency}`;
                                injectionMessage = `\n\n💰 **INYECCIÓN DE SALDO EXITOSA:** Se inyectaron **$${amountToInject.toFixed(2)} USD** a la billetera del cliente (\`${google_id}\`).\n\n*(Monto del pago: ${montoReportado})*`;
                            } catch (e) {
                                console.error("ERROR CRITICO: Falló la llamada RPC para inyección de saldo.", e.message);
                                throw new Error(`Falló la inyección atómica (RPC). Error: ${e.message}`);
                            }
                        }
                    } else {
                        // Si NO es 'Recarga de Saldo' (es un producto)
                        injectionMessage = `\n\n🛒 **PRODUCTO ENTREGADO ✅:** No se requería inyección de saldo.`;
                    }
                } // Fin del bloque 'else' si no estaba REALIZADA


                // 5. ACTUALIZACIÓN DEL ESTADO... 
                if (currentStatus !== NEW_STATUS) {
                    console.log(`LOG: Actualizando estado de transacción ${transactionId} a ${NEW_STATUS}.`);
                    const { error: updateError } = await supabase
                        .from('transactions')
                        .update({ 
                            status: NEW_STATUS
                        })
                        .eq('id_transaccion', transactionId)
                        .in('status', ['pendiente', 'CONFIRMADO', 'CONFIRMADO (ERROR SALDO)']); // Incluimos estados de fallo en la inyección
                    
                    if (updateError) {
                        console.error(`ERROR DB: Fallo al actualizar el estado a ${NEW_STATUS}.`, updateError.message);
                        injectionMessage += `\n\n⚠️ **ADVERTENCIA:** Fallo al actualizar el estado de la transacción: ${updateError.message}`;
                    }
                }

                // 6. CONFIRMACIÓN Y EDICIÓN DEL MENSAJE DE TELEGRAM...
                console.log("LOG: Editando mensaje de Telegram.");
                
                const statusMarker = `\n\n------------------------------------------------\n` +
                                     `✅ **ESTADO FINAL: ${NEW_STATUS}**\n` +
                                     `*Marcada por operador a las:* ${new Date().toLocaleTimeString('es-VE')} \n` +
                                     `------------------------------------------------` +
                                     injectionMessage; 

                const newFullText = originalText + statusMarker;
                
                await editTelegramMessage(
                    TELEGRAM_BOT_TOKEN, chatId, messageId, 
                    newFullText, 
                    {}
                );
                
            } catch (e) {
                // Error capturado
                console.error("ERROR FATAL en callback_query handler (Catch block):", e.message);
                await editTelegramMessage(
                    TELEGRAM_BOT_TOKEN, chatId, messageId, 
                    `❌ **ERROR CRÍTICO EN PROCESO DE MARCADO** ❌\n\nTransacción: \`${transactionId}\`\nFallo: ${e.message}\n\n**¡REVISIÓN MANUAL URGENTE!**`,
                    {}
                );
            }
        }
    } 
    
    // ... (Resto del código) ...
    return { statusCode: 200, body: "Webhook processed" };
};

// --- Funciones Auxiliares para Telegram (Sin cambios) ---
async function editTelegramMessage(token, chatId, messageId, text, replyMarkup) {
    const telegramApiUrl = `https://api.telegram.org/bot${token}/editMessageText`;
    try {
        await axios.post(telegramApiUrl, {
            chat_id: chatId,
            message_id: messageId,
            text: text,
            parse_mode: 'Markdown',
            reply_markup: replyMarkup
        });
    } catch (error) {
        console.error("ERROR TELEGRAM: Fallo al editar mensaje de Telegram.", error.response ? error.response.data : error.message);
    }
}

async function sendTelegramAlert(token, chatId, text, replyToMessageId = null) {
    const telegramApiUrl = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
        await axios.post(telegramApiUrl, {
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown',
            reply_to_message_id: replyToMessageId 
        });
    } catch (error) {
        console.error("ERROR TELEGRAM: Fallo al enviar alerta de Telegram.", error.response ? error.response.data : error.message);
    }
}