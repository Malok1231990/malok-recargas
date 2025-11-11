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
        
        // 🔑 Capturamos el texto original completo del mensaje
        const originalText = body.callback_query.message.text;

        const transactionPrefix = 'mark_done_';
        
        // 1. Verificar si es el botón de "Marcar como Realizada"
        if (callbackData.startsWith(transactionPrefix)) {
            const transactionId = callbackData.replace(transactionPrefix, '');
            const NEW_STATUS = 'REALIZADA'; // El estado final de la recarga completada
            
            console.log(`Callback recibido: Intentando marcar transacción ${transactionId} como ${NEW_STATUS}.`);

            try {
                // 2. BUSCAR LA TRANSACCIÓN (Solo para la verificación de estado, no es estrictamente necesario 
                //    leer data completa si solo se necesita el ID)
                const { error: fetchError } = await supabase
                    .from('transactions')
                    .select('status')
                    .eq('id_transaccion', transactionId)
                    .maybeSingle();

                if (fetchError) {
                    console.error(`Error al buscar transacción: ${transactionId}`, fetchError.message);
                    await sendTelegramAlert(TELEGRAM_BOT_TOKEN, chatId, `❌ Error: No se encontró la transacción ${transactionId}.`, messageId);
                    return { statusCode: 200, body: "Processed" };
                }

                // 3. ACTUALIZACIÓN DEL ESTADO (El FIX principal)
                const { error: updateError } = await supabase
                    .from('transactions')
                    .update({ 
                        status: NEW_STATUS
                    })
                    .eq('id_transaccion', transactionId)
                    // ✅ ACEPTAMOS PENDIENTE (Manual) O CONFIRMADO (Plisio)
                    .in('status', ['pendiente', 'CONFIRMADO']); 
                
                if (updateError) {
                    console.error(`Error al actualizar el estado a ${NEW_STATUS}:`, updateError.message);
                    await editTelegramMessage(
                        TELEGRAM_BOT_TOKEN, chatId, messageId, 
                        `⚠️ Fallo al actualizar ${transactionId} a ${NEW_STATUS}: ${updateError.message}`, 
                        {}
                    );
                    return { statusCode: 200, body: "Processed" };
                }
                
                // 4. CONFIRMACIÓN Y EDICIÓN DEL MENSAJE DE TELEGRAM (La nueva lógica)
                
                // Creamos el marcador de estado final para añadir al final del texto original
                const statusMarker = `\n\n------------------------------------------------\n` +
                                     `✅ **ESTADO FINAL: ${NEW_STATUS}**\n` +
                                     `*Marcada por operador a las:* ${new Date().toLocaleTimeString('es-VE')} \n` +
                                     `------------------------------------------------`;

                // Combinamos el texto original capturado con el nuevo marcador
                const newFullText = originalText + statusMarker;
                
                await editTelegramMessage(
                    TELEGRAM_BOT_TOKEN, chatId, messageId, 
                    newFullText, // <-- Usamos el texto completo + el marcador
                    {}           // Esto elimina el botón inline
                );
                
            } catch (e) {
                console.error("Error FATAL en callback_query handler:", e.message);
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
        console.log("Mensaje de Telegram editado exitosamente.");
    } catch (error) {
        console.error("Fallo al editar mensaje de Telegram.", error.response ? error.response.data : error.message);
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
        console.error("Fallo al enviar alerta de Telegram.", error.response ? error.response.data : error.message);
    }
}