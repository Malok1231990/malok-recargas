// netlify/functions/process-payment.js
const axios = require('axios');
const { IncomingForm } = require('formidable');
const fs = require('fs');
const FormData = require('form-data');
const { Readable } = require('stream');

exports.handler = async function(event, context) {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    if (!event.headers['content-type'] || !event.headers['content-type'].includes('multipart/form-data')) {
        return {
            statusCode: 415,
            body: JSON.stringify({ message: "Unsupported Media Type. Expected multipart/form-data." })
        };
    }

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    // URL de tu nueva función de Netlify para manejar webhooks de Telegram
    // Necesitarás reemplazar esto con la URL real de tu función de webhook
    const TELEGRAM_WEBHOOK_BASE_URL = process.env.TELEGRAM_WEBHOOK_BASE_URL || 'https://TU_SITIO.netlify.app/.netlify/functions/telegram-webhook';


    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.error("Missing Telegram Bot Token or Chat ID environment variables.");
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Server configuration error. Telegram credentials not set." })
        };
    }

    return new Promise((resolve, reject) => {
        const decodedBody = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');

        const requestStream = new Readable();
        requestStream.push(decodedBody);
        requestStream.push(null);
        requestStream.headers = event.headers;
        requestStream.method = event.httpMethod;
        requestStream.url = event.path;

        const form = new IncomingForm({
            multiples: true,
        });

        form.parse(requestStream, async (err, fields, files) => {
            if (err) {
                console.error("Error parsing form data:", err);
                return resolve({
                    statusCode: 500,
                    body: JSON.stringify({ message: "Error parsing form data." })
                });
            }

            const game = fields.game ? fields.game[0] : 'N/A';
            const playerId = fields.playerId ? fields.playerId[0] : 'N/A';
            const packageName = fields.package ? fields.package[0] : 'N/A';
            const finalPrice = fields.finalPrice ? parseFloat(fields.finalPrice[0]) : 0;
            const currency = fields.currency ? fields.currency[0] : 'N/A';
            const paymentMethod = fields.paymentMethod ? fields.paymentMethod[0] : 'N/A';

            const paymentReceiptFile = files.paymentReceipt ? files.paymentReceipt[0] : null;

            if (!paymentReceiptFile && game !== "TikTok") {
                return resolve({
                    statusCode: 400,
                    body: JSON.stringify({ message: "Payment receipt is required for this payment method." })
                });
            }

            // --- NUEVO: Generar número de transacción único ---
            const transactionId = `TXN-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

            let captionText = `✨ Nueva Recarga Malok Recargas ✨\n\n`;
            captionText += `🆔 Transacción ID: *${transactionId}*\n`; // Añadido el ID de transacción
            captionText += `🎮 Juego: *${game}*\n`;
            captionText += `👤 ID de Jugador: *${playerId}*\n`;
            captionText += `📦 Paquete: *${packageName}*\n`;
            captionText += `💰 Total a Pagar: *${finalPrice.toFixed(2)} ${currency}*\n`;
            captionText += `💳 Método de Pago: *${paymentMethod.replace('-', ' ').toUpperCase()}*\n`;

            const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/`;

            // --- NUEVO: Configuración del teclado inline ---
            const inlineKeyboard = {
                inline_keyboard: [
                    [{ text: "✅ Marcar como Realizada", callback_data: `mark_done_${transactionId}` }]
                ]
            };

            try {
                if (game === "TikTok") {
                    await axios.post(`${telegramApiUrl}sendMessage`, {
                        chat_id: TELEGRAM_CHAT_ID,
                        text: captionText + "\n\n_NOTA: Comprobante y datos de TikTok se envían por WhatsApp._",
                        parse_mode: 'Markdown'
                    });
                } else if (paymentReceiptFile) {
                    const fileContent = fs.readFileSync(paymentReceiptFile.filepath);

                    const telegramFormData = new FormData();
                    telegramFormData.append('chat_id', TELEGRAM_CHAT_ID);
                    telegramFormData.append('caption', captionText);
                    telegramFormData.append('parse_mode', 'Markdown');
                    telegramFormData.append('photo', fileContent, {
                        filename: paymentReceiptFile.originalFilename,
                        contentType: paymentReceiptFile.mimetype,
                    });
                    telegramFormData.append('reply_markup', JSON.stringify(inlineKeyboard)); // Añadir el teclado inline

                    await axios.post(`${telegramApiUrl}sendPhoto`, telegramFormData, {
                        headers: telegramFormData.getHeaders(),
                        maxBodyLength: Infinity,
                        maxContentLength: Infinity,
                    });

                    fs.unlinkSync(paymentReceiptFile.filepath);
                }

                resolve({
                    statusCode: 200,
                    body: JSON.stringify({ message: "Payment processed and notification sent!" })
                });

            } catch (error) {
                console.error("Error sending Telegram message:", error.response ? error.response.data : error.message);
                if (paymentReceiptFile && fs.existsSync(paymentReceiptFile.filepath)) {
                    fs.unlinkSync(paymentReceiptFile.filepath);
                }
                resolve({
                    statusCode: 500,
                    body: JSON.stringify({ message: "Failed to send notification." })
                });
            }
        });
    });
};