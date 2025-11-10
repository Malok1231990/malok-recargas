// netlify/functions/telegram-webhook.js
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

exports.handler = async (event, context) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // --- Variables de Entorno ---
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID; // Usado solo para referencia, el ID del chat viene del webhook
    
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !TELEGRAM_BOT_TOKEN) {
        console.error("Faltan variables de entorno esenciales.");
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
        const transactionPrefix = 'mark_done_';
        
        // 1. Verificar si es el botón de "Marcar como Realizada"
        if (callbackData.startsWith(transactionPrefix)) {
            const transactionId = callbackData.replace(transactionPrefix, '');
            const NEW_STATUS = 'REALIZADA';
            
            console.log(`Callback recibido: Intentando marcar transacción ${transactionId} como ${NEW_STATUS}.`);

            try {
                // 2. BUSCAR LA TRANSACCIÓN (Para obtener datos y editar el mensaje)
                const { data: transaction, error: fetchError } = await supabase
                    .from('transactions')
                    .select('status, telegram_message_id, finalPrice, currency, game')
                    .eq('id_transaccion', transactionId)
                    .maybeSingle();

                if (fetchError || !transaction) {
                    console.error(`Error al buscar transacción: ${transactionId}`, fetchError || "No encontrada");
                    await sendTelegramAlert(TELEGRAM_BOT_TOKEN, chatId, `❌ Error: No se encontró la transacción ${transactionId}.`, messageId);
                    return { statusCode: 200, body: "Processed" };
                }

                // 3. ACTUALIZACIÓN DEL ESTADO (EL FIX)
                const { error: updateError } = await supabase
                    .from('transactions')
                    .update({ 
                        status: NEW_STATUS,
                        fecha_servicio_finalizado: new Date().toISOString()
                    })
                    .eq('id_transaccion', transactionId)
                    // ✅ ACEPTAMOS TANTO PENDIENTE (Manual) COMO CONFIRMADO (Plisio)
                    .in('status', ['pendiente', 'CONFIRMADO']); 
                
                if (updateError) {
                    console.error(`Error al actualizar el estado a ${NEW_STATUS}:`, updateError.message);
                    await editTelegramMessage(
                        TELEGRAM_BOT_TOKEN, chatId, messageId, 
                        `⚠️ Fallo al actualizar ${transactionId} a ${NEW_STATUS}: ${updateError.message}`, 
                        {} // Sin botones
                    );
                    return { statusCode: 200, body: "Processed" };
                }
                
                // 4. CONFIRMACIÓN Y EDICIÓN DEL MENSAJE DE TELEGRAM
                const confirmationText = `✅ ¡RECARGA ${transactionId} MARCADA COMO REALIZADA! ✅\n\n` +
                                         `*Juego:* ${transaction.game}\n` +
                                         `*Monto:* ${transaction.finalPrice} ${transaction.currency}\n` +
                                         `*Estado final:* \`${NEW_STATUS}\`\n\n` +
                                         `*Hora:* ${new Date().toLocaleTimeString('es-VE')}`;

                await editTelegramMessage(
                    TELEGRAM_BOT_TOKEN, chatId, messageId, 
                    confirmationText, 
                    {} // Se pasa un objeto vacío para eliminar el botón inline
                );
                
                // 5. Opcional: Ejecutar lógica de recarga/notificación al cliente si no se hizo antes
                // if (transaction.status === 'pendiente') { /* Lógica para recarga manual */ }
                
            } catch (e) {
                console.error("Error FATAL en callback_query handler:", e.message);
            }
        }
    } 
    
    // Aquí puedes incluir la lógica para otros tipos de actualizaciones de Telegram (mensajes, etc.)
    
    // Siempre devuelve 200 OK para confirmar la recepción del webhook
    return { statusCode: 200, body: "Webhook processed" };
};

// --- Funciones Auxiliares para Telegram ---

// Edita un mensaje existente (para quitar el botón y confirmar)
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
        console.log("Mensaje de Telegram editado exitosamente.");
    } catch (error) {
        console.error("Fallo al editar mensaje de Telegram.", error.response ? error.response.data : error.message);
    }
}

// Envía un mensaje simple (para errores)
async function sendTelegramAlert(token, chatId, text, replyToMessageId = null) {
    const telegramApiUrl = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
        await axios.post(telegramApiUrl, {
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown',
            reply_to_message_id: replyToMessageId // Opcional
        });
    } catch (error) {
        console.error("Fallo al enviar alerta de Telegram.", error.response ? error.response.data : error.message);
    }
}

// ----------------------------------------------------------------------
// FIN DEL ARCHIVO telegram-webhook.js
// ----------------------------------------------------------------------