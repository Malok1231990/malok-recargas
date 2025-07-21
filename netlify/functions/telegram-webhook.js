// netlify/functions/telegram-webhook.js
const axios = require('axios');

exports.handler = async function(event, context) {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID; // Asegúrate de que este sea el mismo chat ID

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.error("Missing Telegram Bot Token or Chat ID environment variables.");
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Server configuration error. Telegram credentials not set." })
        };
    }

    try {
        const update = JSON.parse(event.body);

        // --- Manejar Callback Queries (cuando se presiona un botón inline) ---
        if (update.callback_query) {
            const callbackQuery = update.callback_query;
            const data = callbackQuery.data;
            const message = callbackQuery.message;
            const from = callbackQuery.from; // Información del usuario que presionó el botón

            // Responder a la callback query para quitar el reloj de carga del botón
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                callback_query_id: callbackQuery.id,
                text: "Marcado como realizado.",
                show_alert: false // No mostrar un pop-up grande al usuario
            });

            // Si el botón presionado es "mark_done_XYZ"
            if (data.startsWith('mark_done_')) {
                const transactionId = data.substring('mark_done_'.length);

                let newCaptionText;
                let messageType = 'text'; // Por defecto, asumimos que es un mensaje de texto

                if (message.caption) { // Si el mensaje original tenía una foto y caption
                    newCaptionText = message.caption;
                    messageType = 'photo';
                } else if (message.text) { // Si el mensaje original era solo texto
                    newCaptionText = message.text;
                } else {
                    console.warn("Unsupported message type for editing:", message);
                    return { statusCode: 200, body: "Unsupported message type." };
                }

                // Añadir el estado "Realizada" y quién lo marcó
                const userWhoMarked = from.username ? `@${from.username}` : from.first_name || 'Alguien';
                const timestamp = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' }); // Ajusta la zona horaria si es necesario
                const statusLine = `\n\n*✅ REALIZADA por ${userWhoMarked} el ${timestamp}*`;

                // Evitar duplicar la línea de estado si ya existe
                if (!newCaptionText.includes('✅ REALIZADA')) {
                    newCaptionText += statusLine;
                }

                // Editar el mensaje original
                if (messageType === 'photo') {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageCaption`, {
                        chat_id: message.chat.id,
                        message_id: message.message_id,
                        caption: newCaptionText,
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [] } // Quita el teclado inline
                    });
                } else { // Asumimos que es un mensaje de texto
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                        chat_id: message.chat.id,
                        message_id: message.message_id,
                        text: newCaptionText,
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [] } // Quita el teclado inline
                    });
                }

                console.log(`Transaction ${transactionId} marked as done by ${userWhoMarked}.`);
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Webhook processed" })
        };
    } catch (error) {
        console.error("Error processing Telegram webhook:", error.response ? error.response.data : error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Failed to process webhook." })
        };
    }
};