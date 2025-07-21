// netlify/functions/process-payment.js
const axios = require('axios');
const { IncomingForm } = require('formidable'); // Cambiado: Ahora importamos IncomingForm
const fs = require('fs');
const FormData = require('form-data');

exports.handler = async function(event, context) {
    // Solo permitir POST requests
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // Asegurarse de que el Content-Type es multipart/form-data
    if (!event.headers['content-type'] || !event.headers['content-type'].includes('multipart/form-data')) {
        return {
            statusCode: 415,
            body: JSON.stringify({ message: "Unsupported Media Type. Expected multipart/form-data." })
        };
    }

    // Variables de entorno para el token del bot y el chat ID (MUY IMPORTANTE para seguridad)
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.error("Missing Telegram Bot Token or Chat ID environment variables.");
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Server configuration error. Telegram credentials not set." })
        };
    }

    return new Promise((resolve, reject) => {
        const decodedBody = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');

        // Cambiado: Instanciamos IncomingForm directamente
        const form = new IncomingForm({
            multiples: true,
            // Mantener el directorio de carga temporal predeterminado, que suele ser /tmp en Netlify Functions.
            // uploadDir: '/tmp', // Puedes especificarlo explícitamente si tienes problemas
        });

        form.parse(decodedBody, async (err, fields, files) => {
            if (err) {
                console.error("Error parsing form data:", err);
                return resolve({
                    statusCode: 500,
                    body: JSON.stringify({ message: "Error parsing form data." })
                });
            }

            let transactionDetails;
            try {
                // formidable devuelve los campos como arrays
                transactionDetails = JSON.parse(fields.transactionDetails[0]);
            } catch (parseError) {
                console.error("Error parsing transactionDetails:", parseError);
                return resolve({
                    statusCode: 400,
                    body: JSON.stringify({ message: "Invalid transaction details format." })
                });
            }

            const { game, playerId, package: packageName, finalPrice, currency } = transactionDetails;
            const paymentMethod = fields.paymentMethod[0];

            const paymentReceiptFile = files.paymentReceipt ? files.paymentReceipt[0] : null;

            if (!paymentReceiptFile && game !== "TikTok") {
                return resolve({
                    statusCode: 400,
                    body: JSON.stringify({ message: "Payment receipt is required for this payment method." })
                });
            }

            let captionText = `✨ Nueva Recarga Malok Recargas ✨\n\n`;
            captionText += `🎮 Juego: *${game}*\n`;
            captionText += `👤 ID de Jugador: *${playerId || 'N/A'}*\n`;
            captionText += `📦 Paquete: *${packageName}*\n`;
            captionText += `💰 Total a Pagar: *${parseFloat(finalPrice).toFixed(2)} ${currency}*\n`;
            captionText += `💳 Método de Pago: *${paymentMethod.replace('-', ' ').toUpperCase()}*\n`;

            const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/`;

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

                    await axios.post(`${telegramApiUrl}sendPhoto`, telegramFormData, {
                        headers: telegramFormData.getHeaders(),
                        maxBodyLength: Infinity,
                        maxContentLength: Infinity,
                    });

                    fs.unlinkSync(paymentReceiptFile.filepath); // Limpia el archivo temporal
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