// netlify/functions/process-payment.js
const axios = require('axios'); // Necesitarás instalar axios

exports.handler = async function(event, context) {
    // Solo permitir POST requests
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // Asegurarse de que el cuerpo de la solicitud sea JSON
    const data = JSON.parse(event.body);

    // Variables de entorno para el token del bot y el chat ID (MUY IMPORTANTE para seguridad)
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.error("Missing Telegram Bot Token or Chat ID environment variables.");
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Server configuration error." })
        };
    }

    const { game, playerId, package: packageName, finalPrice, currency, payment } = data;
    const { method, phone, reference, txid } = payment;

    // Construir el mensaje para Telegram
    let messageText = `✨ Nueva Recarga Malok Recargas ✨\n\n`;
    messageText += `🎮 Juego: *${game}*\n`;
    messageText += `👤 ID de Jugador: *${playerId}*\n`;
    messageText += `📦 Paquete: *${packageName}*\n`;
    messageText += `💰 Total a Pagar: *${finalPrice} ${currency}*\n`;
    messageText += `💳 Método de Pago: *${method.replace('-', ' ').toUpperCase()}*\n`;

    if (method === 'pago-movil') {
        messageText += `📞 Teléfono Pago Móvil: ${phone}\n`;
        messageText += `📊 Referencia Pago Móvil: ${reference}\n`;
    } else if (method === 'binance') {
        messageText += `🆔 TXID Binance: ${txid}\n`;
    } else if (method === 'zinli') {
        messageText += `📊 Referencia Zinli: ${reference}\n`;
    }

    const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    try {
        await axios.post(telegramApiUrl, {
            chat_id: TELEGRAM_CHAT_ID,
            text: messageText,
            parse_mode: 'Markdown' // Para que el texto en negrita y cursiva funcione
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Payment processed and notification sent!" })
        };
    } catch (error) {
        console.error("Error sending Telegram message:", error.response ? error.response.data : error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Failed to send notification." })
        };
    }
};