// netlify/functions/process-payment.js
const axios = require('axios');
const { Formidable } = require('formidable');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const { Readable } = require('stream'); // ¡NUEVA IMPORTACIÓN! Necesitas el módulo 'stream'

exports.handler = async function(event, context) {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    let data;
    let paymentReceiptFile; 

    // --- Configuración de Supabase ---
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // --- Parsing de FormData con formidable ---
    // ¡MODIFICACIÓN AQUÍ para el objeto 'req' para formidable!
    const form = new Formidable({ multiples: true }); // 'multiples: true' es útil si esperas múltiples archivos, aunque aquí es uno solo.

    // Creamos un stream Readable a partir del cuerpo del evento
    // Esto es lo que 'formidable' espera como entrada.
    const reqStream = new Readable();
    reqStream.push(event.body);
    reqStream.push(null); // Indica el final del stream

    // También necesitamos simular los headers de la petición para formidable
    reqStream.headers = event.headers; // Adjuntamos los headers del evento Netlify al stream simulado
    reqStream.method = event.httpMethod; // Adjuntamos el método HTTP

    try {
        if (event.headers['content-type'] && event.headers['content-type'].includes('multipart/form-data')) {
            // Pasamos el stream simulado 'reqStream' a formidable
            const { fields, files } = await new Promise((resolve, reject) => {
                form.parse(reqStream, (err, fields, files) => { // ¡CAMBIO AQUÍ! Pasamos reqStream
                    if (err) {
                        console.error('Formidable parse error:', err);
                        return reject(err);
                    }
                    resolve({ fields, files });
                });
            });

            // formidable V3+ devuelve campos y archivos como arrays. Ajustar para extraer el primer valor.
            data = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
            paymentReceiptFile = files['paymentReceipt'] ? files['paymentReceipt'][0] : null;

        } else if (event.headers['content-type'] && event.headers['content-type'].includes('application/json')) {
            data = JSON.parse(event.body);
        } else {
            const { parse } = require('querystring');
            data = parse(event.body);
        }
    } catch (parseError) {
        console.error("Error al procesar los datos de la solicitud:", parseError);
        return {
            statusCode: 400,
            body: JSON.stringify({ message: "Error al procesar los datos de la solicitud." })
        };
    }

    // Asegúrate de que las variables de entorno estén configuradas
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const SMTP_HOST = process.env.SMTP_HOST;
    const SMTP_PORT = process.env.SMTP_PORT;
    const SMTP_USER = process.env.SMTP_USER;
    const SMTP_PASS = process.env.SMTP_PASS;
    const SENDER_EMAIL = process.env.SENDER_EMAIL || SMTP_USER;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !SMTP_HOST || !parseInt(SMTP_PORT, 10) || !SMTP_USER || !SMTP_PASS || !supabaseUrl || !supabaseServiceKey) {
        console.error("Faltan variables de entorno requeridas o SMTP_PORT no es un número válido.");
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error de configuración del servidor: Faltan credenciales o configuración inválida." })
        };
    }

    const { game, playerId, package: packageName, finalPrice, currency, paymentMethod, email, whatsappNumber } = data;
    
    let methodSpecificDetails = {};
    if (paymentMethod === 'pago-movil') {
        methodSpecificDetails.phone = data.phone;
        methodSpecificDetails.reference = data.reference;
    } else if (paymentMethod === 'binance') {
        methodSpecificDetails.txid = data.txid;
    } else if (paymentMethod === 'zinli') {
        methodSpecificDetails.reference = data.reference;
    }

    // --- Guardar Transacción Inicial en Supabase ---
    let newTransactionData;
    let id_transaccion_generado; // ID único generado para la transacción

    try {
        id_transaccion_generado = `MALOK-${Date.now()}`; // Un ID único simple

        const { data: insertedData, error: insertError } = await supabase
            .from('transactions')
            .insert({
                id_transaccion: id_transaccion_generado,
                game: game,
                playerId: playerId || null,
                packageName: packageName,
                finalPrice: parseFloat(finalPrice), // Asegurarse de que sea un número
                currency: currency,
                paymentMethod: paymentMethod,
                email: email,
                whatsappNumber: whatsappNumber || null,
                methodDetails: methodSpecificDetails,
                status: 'pendiente', // Estado inicial, el default de la tabla debería manejarlo
                // timestamp: ya se auto-genera con now()
                telegram_chat_id: TELEGRAM_CHAT_ID, // Guardamos el chat ID de Telegram para futuras referencias
                // telegram_message_id: null, // Lo actualizaremos después de enviar el mensaje
                receipt_url: paymentReceiptFile ? paymentReceiptFile.filepath : null // Guardar la ruta temporal si hay comprobante
            })
            .select(); // Esto devuelve los datos insertados, incluyendo el 'id' generado por Supabase

        if (insertError) {
            throw insertError;
        }
        newTransactionData = insertedData[0]; // Supabase devuelve un array, tomamos el primer elemento
        console.log("Transacción guardada en Supabase:", newTransactionData.id);

    } catch (supabaseError) {
        console.error("Error al guardar la transacción en Supabase:", supabaseError.message);
        // Para este caso, continuaremos pero el estado no será persistente
        // Y el botón de Telegram podría no funcionar si no se guarda el ID de transacción.
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error al guardar la transacción en la base de datos." })
        };
    }

    // --- Enviar Notificación a Telegram ---
    let messageText = `✨ Nueva Recarga Malok Recargas ✨\n\n`;
    messageText += `*ID de Transacción:* \`${id_transaccion_generado || 'N/A'}\`\n`; // Añadimos el ID de la transacción
    messageText += `*Estado:* \`PENDIENTE\`\n\n`;
    messageText += `🎮 Juego: *${game}*\n`;
    messageText += `👤 ID de Jugador: *${playerId || 'N/A'}*\n`;
    messageText += `📦 Paquete: *${packageName}*\n`;
    messageText += `💰 Total a Pagar: *${finalPrice} ${currency}*\n`;
    messageText += `💳 Método de Pago: *${paymentMethod.replace('-', ' ').toUpperCase()}*\n`;
    messageText += `📧 Correo Cliente: ${email}\n`;
    if (whatsappNumber) {
        messageText += `📱 WhatsApp Cliente: ${whatsappNumber}\n`;
    }

    if (paymentMethod === 'pago-movil') {
        messageText += `📞 Teléfono Pago Móvil: ${methodSpecificDetails.phone || 'N/A'}\n`;
        messageText += `📊 Referencia Pago Móvil: ${methodSpecificDetails.reference || 'N/A'}\n`;
    } else if (paymentMethod === 'binance') {
        messageText += `🆔 TXID Binance: ${methodSpecificDetails.txid || 'N/A'}\n`;
    } else if (paymentMethod === 'zinli') {
        messageText += `📊 Referencia Zinli: ${methodSpecificDetails.reference || 'N/A'}\n`;
    }

    const replyMarkup = {
        inline_keyboard: [
            [{ text: "✅ Marcar como Realizada", callback_data: `mark_done_${id_transaccion_generado}` }]
        ]
    };

    const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    let telegramMessageResponse;

    try {
        telegramMessageResponse = await axios.post(telegramApiUrl, {
            chat_id: TELEGRAM_CHAT_ID,
            text: messageText,
            parse_mode: 'Markdown',
            reply_markup: replyMarkup
        });
        console.log("Mensaje de Telegram enviado con éxito.");

        // --- Actualizar Transaction en Supabase con el Message ID de Telegram ---
        if (newTransactionData && telegramMessageResponse && telegramMessageResponse.data && telegramMessageResponse.data.result) {
            const { data: updatedData, error: updateError } = await supabase
                .from('transactions')
                .update({ telegram_message_id: telegramMessageResponse.data.result.message_id })
                .eq('id', newTransactionData.id); // Usamos el 'id' generado por Supabase para la actualización

            if (updateError) {
                console.error("Error al actualizar la transacción en Supabase con telegram_message_id:", updateError.message);
            } else {
                console.log("Transaction actualizada en Supabase con telegram_message_id:", telegramMessageResponse.data.result.message_id);
            }
        }

    } catch (telegramError) {
        console.error("Error al enviar mensaje de Telegram:", telegramError.response ? telegramError.response.data : telegramError.message);
        // Si falla el Telegram, al menos la transacción ya está en Supabase
    }

    // --- Enviar Confirmación por Correo Electrónico al Cliente (con Nodemailer) ---
    if (email) {
        let transporter;
        try {
            transporter = nodemailer.createTransport({
                host: SMTP_HOST,
                port: parseInt(SMTP_PORT, 10),
                secure: parseInt(SMTP_PORT, 10) === 465,
                auth: {
                    user: SMTP_USER,
                    pass: SMTP_PASS,
                },
                tls: {
                    rejectUnauthorized: false
                }
            });
        } catch (createTransportError) {
            console.error("Error al crear el transportador de Nodemailer:", createTransportError);
        }

        const mailOptions = {
            from: SENDER_EMAIL,
            to: email,
            subject: `🎉 Tu Solicitud de Recarga de ${game} con Malok Recargas ha sido Recibida! 🎉`,
            html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                    <h2 style="color: #007bff;">¡Hola!</h2>
                    <p>Hemos recibido tu solicitud de recarga para <strong>${game}</strong> con ID: <strong>${id_transaccion_generado}</strong>.</p>
                    <p>Aquí están los detalles que nos proporcionaste:</p>
                    <ul style="list-style: none; padding: 0;">
                        <li><strong>Juego:</strong> ${game}</li>
                        ${playerId ? `<li><strong>ID de Jugador:</strong> ${playerId}</li>` : ''}
                        <li><strong>Paquete:</strong> ${packageName}</li>
                        <li><strong>Monto a Pagar:</strong> ${finalPrice} ${currency}</li>
                        <li><strong>Método de Pago Seleccionado:</strong> ${paymentMethod.replace('-', ' ').toUpperCase()}</li>
                        ${whatsappNumber ? `<li><strong>Número de WhatsApp Proporcionado:</strong> ${whatsappNumber}</li>` : ''}
                    </ul>
                    <p>Tu solicitud está actualmente en estado: <strong>PENDIENTE</strong>.</p>
                    <p>Estamos procesando tu recarga. Te enviaremos un <strong>correo de confirmación de la recarga completada y tu factura virtual una vez que tu recarga sea procesada</strong> por nuestro equipo.</p>
                    <p style="margin-top: 20px;">¡Gracias por confiar en Malok Recargas!</p>
                    <p style="font-size: 0.9em; color: #777;">Si tienes alguna pregunta, contáctanos a través de nuestro WhatsApp: <a href="https://wa.me/584126949631" style="color: #28a745; text-decoration: none;">+58 412 6949631</a></p>
                </div>
            `,
        };

        if (paymentReceiptFile && paymentReceiptFile.filepath) {
            const fs = require('fs');
            try {
                const fileBuffer = fs.readFileSync(paymentReceiptFile.filepath);
                mailOptions.attachments = [
                    {
                        filename: paymentReceiptFile.originalFilename || 'comprobante_pago.jpg',
                        content: fileBuffer.toString('base64'),
                        encoding: 'base64',
                        contentType: paymentReceiptFile.mimetype || 'application/octet-stream',
                        cid: 'receipt@malok.recargas.com'
                    },
                ];
                console.log("Comprobante de pago adjuntado al correo.");
            } catch (fileReadError) {
                console.error("Error al leer el archivo del comprobante para adjuntar:", fileReadError);
            } finally {
                if (fs.existsSync(paymentReceiptFile.filepath)) {
                    fs.unlinkSync(paymentReceiptFile.filepath); // Eliminar archivo temporal
                }
            }
        }

        try {
            await transporter.sendMail(mailOptions);
            console.log("Correo de confirmación inicial enviado al cliente:", email);
        } catch (emailError) {
            console.error("Error al enviar el correo de confirmación inicial:", emailError.message);
            if (emailError.response) {
                console.error("Detalles del error SMTP:", emailError.response);
            }
        }
    }

    return {
        statusCode: 200,
        body: JSON.stringify({ message: "Notificación de pago enviada y confirmación por correo intentada!" }),
    };
};