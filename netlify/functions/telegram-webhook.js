// netlify/functions/telegram-webhook.js
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    if (!TELEGRAM_BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        console.error("Faltan variables de entorno requeridas para el webhook de Telegram.");
        return { statusCode: 500, body: "Error de configuración del servidor." };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    try {
        const body = JSON.parse(event.body);
        const callbackQuery = body.callback_query;

        if (callbackQuery) {
            const chatId = callbackQuery.message.chat.id;
            const messageId = callbackQuery.message.message_id; // ID del mensaje original que se va a editar
            const userId = callbackQuery.from.id; // ID del usuario que presionó el botón
            const userName = callbackQuery.from.first_name || `Usuario ${userId}`; // Nombre del usuario
            const data = callbackQuery.data;

            if (data.startsWith('mark_done_')) {
                const transactionId = data.replace('mark_done_', '');

                // 1. Obtener la transacción de Supabase
                const { data: transaction, error: fetchError } = await supabase
                    .from('transactions')
                    .select('*')
                    .eq('id_transaccion', transactionId) // Usa 'id_transaccion' que es tu ID generado
                    .single();

                if (fetchError || !transaction) {
                    console.error("Error al obtener la transacción de Supabase:", fetchError ? fetchError.message : "Transacción no encontrada.");
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: `❌ Error: No se pudo encontrar la transacción ${transactionId}.`,
                    });
                    return { statusCode: 200, body: "Error fetching transaction" };
                }

                // Verificar si ya está marcada para evitar re-procesamiento
                if (transaction.status === 'realizada') {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                        callback_query_id: callbackQuery.id,
                        text: "¡Esta recarga ya fue marcada como realizada!",
                        show_alert: true
                    });
                     // Opcional: editar el mensaje original para indicar que ya está realizada
                    return { statusCode: 200, body: "Already completed" };
                }

                // 2. Actualizar el estado en Supabase
                const { error: updateError } = await supabase
                    .from('transactions')
                    .update({
                        status: 'realizada',
                        completed_at: new Date().toISOString(), // Usar ISO string para timestampz
                        completed_by: userName // Guardar quién la completó
                    })
                    .eq('id_transaccion', transactionId);

                if (updateError) {
                    console.error("Error al actualizar la transacción en Supabase:", updateError.message);
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: `❌ Error al procesar la recarga ${transactionId}: ${updateError.message}. Consulta los logs de Netlify.`,
                    });
                    return { statusCode: 200, body: "Error updating transaction" };
                }

                // 3. Editar el mensaje original en Telegram
                let newCaption = callbackQuery.message.text; // Captura el texto actual del mensaje
                // Reemplaza "Estado: PENDIENTE" con "Estado: REALIZADA"
                newCaption = newCaption.replace('Estado: `PENDIENTE`', 'Estado: `REALIZADA` ✅');
                // Añade la línea "Recarga marcada por:"
                newCaption += `\n\nRecarga marcada por: *${userName}* (${new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })} ${new Date().toLocaleDateString('es-VE')})`; //

                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                    chat_id: chatId,
                    message_id: messageId,
                    text: newCaption,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ Recarga Realizada", callback_data: `completed_${transactionId}` }] // Cambiar el botón para indicar que ya está completa
                        ]
                    }
                });

                // 4. Enviar un feedback al usuario que presionó el botón
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQuery.id,
                    text: `Recarga ${transactionId} marcada como realizada por ${userName}.`,
                    show_alert: false // No mostrar una alerta grande
                });
            }
        }
        return { statusCode: 200, body: "Webhook processed" };
    } catch (error) {
        console.error("Error en el webhook de Telegram:", error.message);
        return { statusCode: 500, body: `Error en el webhook: ${error.message}` };
    }
};