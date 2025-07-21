// netlify/functions/process-payment.js
const axios = require('axios');
const { IncomingForm } = require('formidable');
const fs = require('fs');
const FormData = require('form-data');
const { Readable } = require('stream');
const nodemailer = require('nodemailer'); // <-- ¡NUEVO!

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
    const TELEGRAM_WEBHOOK_BASE_URL = process.env.TELEGRAM_WEBHOOK_BASE_URL || 'https://TU_SITIO.netlify.app/.netlify/functions/telegram-webhook';

    // <-- ¡NUEVAS VARIABLES DE ENTORNO PARA GMAIL!
    const GMAIL_USER = process.env.GMAIL_USER; // Tu dirección de correo Gmail
    const GMAIL_APP_PASS = process.env.GMAIL_APP_PASS; // La contraseña de aplicación de Gmail
    // FIN NUEVAS VARIABLES -->

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !GMAIL_USER || !GMAIL_APP_PASS) {
        console.error("Missing environment variables for Telegram or Email.");
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Server configuration error. Missing credentials." })
        };
    }

    // <-- ¡NUEVO: Configuración del transportador de Nodemailer!
    const transporter = nodemailer.createTransport({
        service: 'gmail', // O 'smtp' si usas otro proveedor que no sea Gmail
        auth: {
            user: GMAIL_USER,
            pass: GMAIL_APP_PASS
        }
    });
    // FIN NUEVO -->

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
            // <-- ¡NUEVOS CAMPOS DEL FORMULARIO!
            const whatsappNumber = fields.whatsappNumber ? fields.whatsappNumber[0] : null;
            const email = fields.email ? fields.email[0] : null;
            // FIN NUEVOS CAMPOS -->

            const paymentReceiptFile = files.paymentReceipt ? files.paymentReceipt[0] : null;

            if (!paymentReceiptFile && game !== "TikTok") {
                return resolve({
                    statusCode: 400,
                    body: JSON.stringify({ message: "Payment receipt is required for this payment method." })
                });
            }
            if (!email) { // El email es ahora requerido para las notificaciones
                 return resolve({
                    statusCode: 400,
                    body: JSON.stringify({ message: "Email is required for notifications." })
                });
            }

            const transactionId = `TXN-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

            let captionText = `✨ Nueva Recarga Malok Recargas ✨\n\n`;
            captionText += `🆔 Transacción ID: *${transactionId}*\n`;
            captionText += `🎮 Juego: *${game}*\n`;
            captionText += `👤 ID de Jugador: *${playerId}*\n`;
            captionText += `📦 Paquete: *${packageName}*\n`;
            captionText += `💰 Total a Pagar: *${finalPrice.toFixed(2)} ${currency}*\n`;
            captionText += `💳 Método de Pago: *${paymentMethod.replace('-', ' ').toUpperCase()}*\n`;
            if (whatsappNumber) {
                captionText += `📞 WhatsApp Cliente: *${whatsappNumber}*\n`;
            }
            if (email) { // Añade el correo al mensaje de Telegram
                captionText += `📧 Correo Cliente: *${email}*\n`;
            }

            const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/`;

            const inlineKeyboard = {
                inline_keyboard: [
                    [{
                        text: "✅ Marcar como Realizada",
                        // Asegúrate de que el email se pasa correctamente para la factura
                        callback_data: `mark_done_${transactionId}_${email}`
                    }]
                ]
            };

            try {
                // <-- ¡NUEVO: Envío de correo inicial con Nodemailer!
                if (email) {
                    const mailOptions = {
                        from: GMAIL_USER, // Tu dirección de Gmail
                        to: email,
                        subject: `Malok Recargas: Hemos recibido tu solicitud (${transactionId})`,
                        text: `¡Hola!\n\nHemos recibido tu solicitud de recarga para ${game} (ID de Transacción: ${transactionId}).\n\nTe notificaremos por correo cuando tu recarga sea exitosa.\n\nGracias por usar Malok Recargas!\n\nAtentamente,\nEl equipo de Malok Recargas`,
                        html: `<p>¡Hola!</p>
                               <p>Hemos recibido tu solicitud de recarga para <strong>${game}</strong> (ID de Transacción: <strong>${transactionId}</strong>).</p>
                               <p>Te notificaremos por correo cuando tu recarga sea exitosa.</p>
                               <p>¡Gracias por usar Malok Recargas! 😊</p>
                               <p>Atentamente,<br>El equipo de Malok Recargas</p>`
                    };
                    try {
                        await transporter.sendMail(mailOptions);
                        console.log(`Correo inicial enviado a ${email} para TXN ${transactionId}`);
                    } catch (emailError) {
                        console.error("Error al enviar correo inicial con Nodemailer:", emailError);
                        // Importante: No fallar la función principal si falla el envío de correo, solo registrar el error
                    }
                }
                // FIN NUEVO -->

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
                    telegramFormData.append('reply_markup', JSON.stringify(inlineKeyboard));

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
                console.error("Error sending Telegram message or other final operations:", error.response ? error.response.data : error.message);
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