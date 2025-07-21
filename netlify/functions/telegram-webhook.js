// netlify/functions/telegram-webhook.js
const axios = require('axios');
const nodemailer = require('nodemailer'); // <-- ¡NUEVO!

exports.handler = async function(event, context) {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
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
        service: 'gmail',
        auth: {
            user: GMAIL_USER,
            pass: GMAIL_APP_PASS
        }
    });
    // FIN NUEVO -->

    try {
        const update = JSON.parse(event.body);

        if (update.callback_query) {
            const callbackQuery = update.callback_query;
            const data = callbackQuery.data;
            const message = callbackQuery.message;
            const from = callbackQuery.from;

            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                callback_query_id: callbackQuery.id,
                text: "Marcado como realizado.",
                show_alert: false
            });

            if (data.startsWith('mark_done_')) {
                const parts = data.split('_');
                const transactionId = parts[2];
                // El email del cliente se pasa desde el callback_data
                const clientEmail = parts[3] === 'null' ? null : parts[3];

                let newCaptionText;
                let messageType = 'text';

                if (message.caption) {
                    newCaptionText = message.caption;
                    messageType = 'photo';
                } else if (message.text) {
                    newCaptionText = message.text;
                } else {
                    console.warn("Unsupported message type for editing:", message);
                    return { statusCode: 200, body: "Unsupported message type." };
                }

                const userWhoMarked = from.username ? `@${from.username}` : from.first_name || 'Alguien';
                const timestamp = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });
                const statusLine = `\n\n*✅ REALIZADA por ${userWhoMarked} el ${timestamp}*`;

                if (!newCaptionText.includes('✅ REALIZADA')) {
                    newCaptionText += statusLine;
                }

                // <-- ¡NUEVO: Generar y enviar factura virtual por correo electrónico con Nodemailer!
                if (clientEmail) {
                    const originalMessageContent = messageType === 'photo' ? message.caption : message.text;
                    // Extraer los datos de la transacción del mensaje de Telegram
                    const gameMatch = originalMessageContent.match(/🎮 Juego: \*(.*?)\*/);
                    const playerIdMatch = originalMessageContent.match(/👤 ID de Jugador: \*(.*?)\*/);
                    const packageMatch = originalMessageContent.match(/📦 Paquete: \*(.*?)\*/);
                    const finalPriceMatch = originalMessageContent.match(/💰 Total a Pagar: \*(.*?)\s(.*?)\*/);
                    const paymentMethodMatch = originalMessageContent.match(/💳 Método de Pago: \*(.*?)\*/);
                    const clientWhatsappMatch = originalMessageContent.match(/📞 WhatsApp Cliente: \*(.*?)\*/); // Obtener WhatsApp si está disponible

                    const invoiceGame = gameMatch ? gameMatch[1] : 'N/A';
                    const invoicePlayerId = playerIdMatch ? playerIdMatch[1] : 'N/A';
                    const invoicePackage = packageMatch ? packageMatch[1] : 'N/A';
                    const invoiceFinalPrice = finalPriceMatch ? finalPriceMatch[1] : 'N/A';
                    const invoiceCurrency = finalPriceMatch ? finalPriceMatch[2] : 'N/A';
                    const invoicePaymentMethod = paymentMethodMatch ? paymentMethodMatch[1] : 'N/A';
                    const invoiceWhatsapp = clientWhatsappMatch ? clientWhatsappMatch[1] : 'N/A';


                    const mailOptions = {
                        from: GMAIL_USER, // Tu dirección de Gmail
                        to: clientEmail,
                        subject: `Malok Recargas: ¡Bravoooo tu recarga ha sido exitosa! (${transactionId})`,
                        text: `¡Bravoooo tu recarga ha sido exitosa! 🎉\n\nAquí tienes tu factura virtual:\n\n` +
                                        `--- Factura Virtual ---\n` +
                                        `🆔 Transacción ID: ${transactionId}\n` +
                                        `🗓️ Fecha/Hora Recarga: ${timestamp}\n` +
                                        `📧 Correo Cliente: ${clientEmail}\n` +
                                        `📞 WhatsApp Cliente: ${invoiceWhatsapp}\n` +
                                        `🎮 Juego: ${invoiceGame}\n` +
                                        `👤 ID de Cuenta/Jugador: ${invoicePlayerId}\n` +
                                        `📦 Paquete Recargado: ${invoicePackage}\n` +
                                        `💰 Monto Pagado: ${invoiceFinalPrice} ${invoiceCurrency}\n` +
                                        `💳 Método de Pago: ${invoicePaymentMethod}\n\n` +
                                        `¡Gracias por preferir Malok Recargas! 😊`,
                        html: `<p>¡Bravoooo tu recarga ha sido exitosa! 🎉</p>
                                        <p>Aquí tienes tu factura virtual:</p>
                                        <hr>
                                        <h3>--- Factura Virtual ---</h3>
                                        <p><strong>🆔 Transacción ID:</strong> ${transactionId}</p>
                                        <p><strong>🗓️ Fecha/Hora Recarga:</strong> ${timestamp}</p>
                                        <p><strong>📧 Correo Cliente:</strong> ${clientEmail}</p>
                                        <p><strong>📞 WhatsApp Cliente:</strong> ${invoiceWhatsapp}</p>
                                        <p><strong>🎮 Juego:</strong> ${invoiceGame}</p>
                                        <p><strong>👤 ID de Cuenta/Jugador:</strong> ${invoicePlayerId}</p>
                                        <p><strong>📦 Paquete Recargado:</strong> ${invoicePackage}</p>
                                        <p><strong>💰 Monto Pagado:</strong> ${invoiceFinalPrice} ${invoiceCurrency}</p>
                                        <p><strong>💳 Método de Pago:</strong> ${invoicePaymentMethod}</p>
                                        <hr>
                                        <p>¡Gracias por preferir Malok Recargas! 😊</p>
                                        <p>Atentamente,<br>El equipo de Malok Recargas</p>`
                    };

                    try {
                        await transporter.sendMail(mailOptions);
                        console.log(`Factura enviada por correo a ${clientEmail} para TXN ${transactionId}`);
                    } catch (emailError) {
                        console.error("Error al enviar factura por correo con Nodemailer:", emailError);
                        // No fallar la función principal si falla el envío de correo
                    }
                }
                // FIN NUEVO -->

                if (messageType === 'photo') {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageCaption`, {
                        chat_id: message.chat.id,
                        message_id: message.message_id,
                        caption: newCaptionText,
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [] }
                    });
                } else {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                        chat_id: message.chat.id,
                        message_id: message.message_id,
                        text: newCaptionText,
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [] }
                    });
                }
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