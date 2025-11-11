// netlify/functions/telegram-webhook.js
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

exports.handler = async (event, context) => {
    if (event.httpMethod !== "POST") {
        console.log("Method Not Allowed: Expected POST.");
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // --- Variables de Entorno ---
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
    // 💡 LÓGICA CLAVE: Manejo de la consulta de Callback (Clic en el botón)
    // ----------------------------------------------------------------------
    if (body.callback_query) {
        const callbackData = body.callback_query.data;
        const chatId = body.callback_query.message.chat.id;
        const messageId = body.callback_query.message.message_id;
        
        // 🔑 Capturamos el texto original completo del mensaje
        const originalText = body.callback_query.message.text;

        const transactionPrefix = 'mark_done_';
        
        // 1. Verificar si es el botón de "Marcar como Realizada"
        if (callbackData.startsWith(transactionPrefix)) {
            const transactionId = callbackData.replace(transactionPrefix, '');
            const NEW_STATUS = 'REALIZADA'; // El estado final de la recarga completada
            
            console.log(`LOG: Callback recibido: Intentando marcar transacción ${transactionId} como ${NEW_STATUS}.`);

            try {
                
                // 2. BUSCAR LA TRANSACCIÓN para obtener datos clave (google_id, finalPrice y status)
                console.log(`LOG: Buscando datos para transacción ${transactionId} en tabla 'transactions'.`);
                const { data: transactionData, error: fetchError } = await supabase
                    .from('transactions')
                    .select('status, google_id, "finalPrice"') 
                    .eq('id_transaccion', transactionId)
                    .maybeSingle();

                if (fetchError || !transactionData) {
                    console.error(`ERROR DB: Fallo al buscar la transacción ${transactionId}.`, fetchError ? fetchError.message : 'No encontrada');
                    await sendTelegramAlert(TELEGRAM_BOT_TOKEN, chatId, `❌ Error: No se encontró la transacción ${transactionId}.`, messageId);
                    return { statusCode: 200, body: "Processed" };
                }

                // Usamos 'finalPrice' en la desestructuración de datos
                const { status: currentStatus, google_id, "finalPrice": finalPrice } = transactionData;
                const amountToInject = parseFloat(finalPrice); // Usamos parseFloat para obtener el monto numérico

                console.log(`LOG: Datos de transacción obtenidos: Cliente ID ${google_id}, Monto $${amountToInject.toFixed(2)}, Estado actual ${currentStatus}.`);
                
                let injectionMessage = ""; // Para el mensaje final de Telegram
                
                // 3. Verificar si ya fue realizada para evitar doble inyección
                if (currentStatus === NEW_STATUS) {
                    injectionMessage = "\n\n⚠️ **NOTA:** La transacción ya estaba en estado 'REALIZADA'. El saldo no fue inyectado de nuevo.";
                } else if (!google_id || isNaN(amountToInject) || amountToInject <= 0) {
                    // Validaciones básicas para inyección
                    injectionMessage = `\n\n❌ **ERROR DE INYECCIÓN DE SALDO:** Datos incompletos (Google ID: ${google_id}, Monto: ${finalPrice}). **¡REVISIÓN MANUAL REQUERIDA!**`;
                } else {
                    // 4. INYECTAR SALDO AL CLIENTE (Usando la función RPC)
                    console.log(`LOG: Intentando inyectar $${amountToInject.toFixed(2)} a 'user_id' ${google_id} usando RPC.`);
                    
                    try {
                        // 💡 CORRECCIÓN CRÍTICA: Se reemplaza .update({ saldo_usd: supabase.fn(...) }) por .rpc()
                        const { error: balanceUpdateError } = await supabase
                            .rpc('incrementar_saldo', { 
                                p_user_id: google_id, 
                                p_monto: amountToInject
                            }); 
                            
                        if (balanceUpdateError) {
                            console.error(`ERROR DB: Fallo al inyectar saldo a ${google_id}. Mensaje: ${balanceUpdateError.message}.`);
                            injectionMessage = `\n\n❌ **ERROR CRÍTICO AL INYECTAR SALDO:** No se pudo actualizar la billetera del cliente (${google_id}). \n\n${balanceUpdateError.message}`;
                            // Si la inyección falla, lanzamos un error para que el 'catch' lo maneje y alerte al operador.
                            throw new Error("Fallo en la inyección de saldo.");
                        }
                        
                    } catch (e) {
                        // Error capturado del fallo de RPC
                        console.error("ERROR CRITICO: Falló la llamada RPC para inyección de saldo.", e.message);
                        throw new Error(`Falló la inyección atómica (RPC). Error: ${e.message}`);
                    }
                    
                    console.log(`LOG: Inyección de saldo exitosa para ${google_id}.`);
                    injectionMessage = `\n\n💰 **INYECCIÓN DE SALDO EXITOSA:** Se inyectaron **$${amountToInject.toFixed(2)} USD** a la billetera del cliente (\`${google_id}\`).`;
                }


                // 5. ACTUALIZACIÓN DEL ESTADO (Solo si no estaba ya en REALIZADA, y si la inyección fue exitosa o no aplicaba)
                if (currentStatus !== NEW_STATUS) {
                    console.log(`LOG: Actualizando estado de transacción ${transactionId} a ${NEW_STATUS}.`);
                    const { error: updateError } = await supabase
                        .from('transactions')
                        .update({ 
                            status: NEW_STATUS
                        })
                        .eq('id_transaccion', transactionId)
                        // ✅ ACEPTAMOS PENDIENTE (Manual) O CONFIRMADO (Plisio)
                        .in('status', ['pendiente', 'CONFIRMADO']); 
                    
                    if (updateError) {
                        console.error(`ERROR DB: Fallo al actualizar el estado a ${NEW_STATUS}.`, updateError.message);
                        // Añadimos la advertencia al mensaje de inyección
                        injectionMessage += `\n\n⚠️ **ADVERTENCIA:** Fallo al actualizar el estado de la transacción: ${updateError.message}`;
                    }
                }

                // 6. CONFIRMACIÓN Y EDICIÓN DEL MENSAJE DE TELEGRAM
                console.log("LOG: Editando mensaje de Telegram.");
                
                // Creamos el marcador de estado final para añadir al final del texto original
                const statusMarker = `\n\n------------------------------------------------\n` +
                                     `✅ **ESTADO FINAL: ${NEW_STATUS}**\n` +
                                     `*Marcada por operador a las:* ${new Date().toLocaleTimeString('es-VE')} \n` +
                                     `------------------------------------------------` +
                                     injectionMessage; // 🎯 CLAVE: Añadir el mensaje de inyección

                // Combinamos el texto original capturado con el nuevo marcador
                const newFullText = originalText + statusMarker;
                
                await editTelegramMessage(
                    TELEGRAM_BOT_TOKEN, chatId, messageId, 
                    newFullText, // <-- Usamos el texto completo + el marcador
                    {}          // Esto elimina el botón inline
                );
                
            } catch (e) {
                // Error capturado del fallo de inyección de saldo o cualquier otro error fatal
                console.error("ERROR FATAL en callback_query handler (Catch block):", e.message);
                // Enviamos una alerta crítica y editamos el mensaje original para indicar el fallo
                await editTelegramMessage(
                    TELEGRAM_BOT_TOKEN, chatId, messageId, 
                    `❌ **ERROR CRÍTICO EN PROCESO DE MARCADO** ❌\n\nTransacción: \`${transactionId}\`\nFallo: ${e.message}\n\n**¡REVISIÓN MANUAL URGENTE!** El saldo *podría no* haberse inyectado y el estado *podría no* haberse actualizado.`,
                    {}
                );
            }
        }
    } 
    
    // ... (El resto del código para manejar otros webhooks) ...
    
    // Siempre devuelve 200 OK
    return { statusCode: 200, body: "Webhook processed" };
};

// --- Funciones Auxiliares para Telegram ---

async function editTelegramMessage(token, chatId, messageId, text, replyMarkup) {
    const telegramApiUrl = `https://api.telegram.org/bot${token}/editMessageText`;
    try {
        await axios.post(telegramApiUrl, {
            chat_id: chatId,
            message_id: messageId,
            text: text,
            parse_mode: 'Markdown',
            reply_markup: replyMarkup // Si es {}, elimina el botón
        });
        //console.log("Mensaje de Telegram editado exitosamente."); // Log de éxito
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