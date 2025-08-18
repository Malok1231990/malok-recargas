// netlify/functions/process-payment.js
const axios = require('axios');
const { Formidable } = require('formidable');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const { Readable } = require('stream'); // Importar Readable para Streams
const fs = require('fs'); // Módulo para operaciones con archivos
const FormData = require('form-data'); // Para construir FormData para envíos a Telegram

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
    const form = new Formidable({ multiples: true });

    let bodyBuffer;
    if (event.isBase64Encoded) {
        bodyBuffer = Buffer.from(event.body, 'base64');
    } else {
        bodyBuffer = Buffer.from(event.body || '');
    }

    const reqStream = new Readable();
    reqStream.push(bodyBuffer);
    reqStream.push(null);

    reqStream.headers = event.headers;
    reqStream.method = event.httpMethod;

    try {
        if (event.headers['content-type'] && event.headers['content-type'].includes('multipart/form-data')) {
            const { fields, files } = await new Promise((resolve, reject) => {
                form.parse(reqStream, (err, fields, files) => {
                    if (err) {
                        console.error('Formidable parse error:', err);
                        return reject(err); 
                    }
                    resolve({ fields, files });
                });
            });

            // Formidable v3+ devuelve campos y archivos como arrays. Extraer el primer valor.
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
            body: JSON.stringify({ message: `Error al procesar los datos de la solicitud: ${parseError.message || 'Unknown error'}. Por favor, verifica tus datos e inténtalo de nuevo.` })
        };
    }

    // --- TEMPORAL: LOGS PARA DEBUGGING DE VARIABLES DE ENTORNO ---
    console.log("DEBUG: TELEGRAM_BOT_TOKEN existe:", !!process.env.TELEGRAM_BOT_TOKEN);
    console.log("DEBUG: TELEGRAM_CHAT_ID existe:", !!process.env.TELEGRAM_CHAT_ID);
    console.log("DEBUG: SMTP_HOST:", process.env.SMTP_HOST);
    console.log("DEBUG: SMTP_PORT:", process.env.SMTP_PORT);
    console.log("DEBUG: SMTP_USER:", process.env.SMTP_USER);
    console.log("DEBUG: SMTP_PASS (length):", process.env.SMTP_PASS ? process.env.SMTP_PASS.length : 'N/A');
    console.log("DEBUG: SUPABASE_URL existe:", !!process.env.SUPABASE_URL);
    console.log("DEBUG: SUPABASE_SERVICE_KEY existe:", !!process.env.SUPABASE_SERVICE_KEY);
    // --- FIN TEMPORAL ---

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

    // Extraer datos del formulario (ya procesados por formidable)
    const { game, playerId, package: packageName, finalPrice, currency, paymentMethod, email, whatsappNumber } = data;
    // NUEVO: Extraer campos específicos para Roblox
    const robloxEmail = data.robloxEmail || null;
    const robloxPassword = data.robloxPassword || null;

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
        id_transaccion_generado = `MALOK-${Date.now()}`; // Generar un ID único simple para la transacción

        const transactionToInsert = {
            id_transaccion: id_transaccion_generado,
            game: game,
            playerId: playerId || null,
            packageName: packageName,
            finalPrice: parseFloat(finalPrice),
            currency: currency,
            paymentMethod: paymentMethod,
            email: email,
            whatsappNumber: whatsappNumber || null,
            methodDetails: methodSpecificDetails,
            status: 'pendiente', // Estado inicial de la transacción
            telegram_chat_id: TELEGRAM_CHAT_ID,
            // telegram_message_id: null, // Se actualizará después de enviar el mensaje a Telegram
            receipt_url: paymentReceiptFile ? paymentReceiptFile.filepath : null 
        };

        // NUEVO: Añadir campos de Roblox si el juego es Roblox
        if (game === 'Roblox') {
            transactionToInsert.robloxEmail = robloxEmail;
            transactionToInsert.robloxPassword = robloxPassword;
        }

        const { data: insertedData, error: insertError } = await supabase
            .from('transactions') // Asegúrate de que 'transactions' es el nombre correcto de tu tabla en Supabase
            .insert(transactionToInsert)
            .select();

        if (insertError) {
            throw insertError;
        }
        newTransactionData = insertedData[0];
        console.log("Transacción guardada en Supabase con ID interno:", newTransactionData.id);

    } catch (supabaseError) {
        console.error("Error al guardar la transacción en Supabase:", supabaseError.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error al guardar la transacción en la base de datos." })
        };
    }

    // --- Enviar Notificación a Telegram ---
    let messageText = `✨ Nueva Recarga Malok Recargas ✨\n\n`;
    messageText += `*ID de Transacción:* \`${id_transaccion_generado || 'N/A'}\`\n`;
    messageText += `*Estado:* \`PENDIENTE\`\n\n`;
    messageText += `🎮 Juego: *${game}*\n`;
    // MODIFICADO: Añadir campos de Roblox si existen, de lo contrario mostrar ID de Jugador
    if (game === 'Roblox') {
        messageText += `📧 Correo Roblox: ${robloxEmail || 'N/A'}\n`;
        messageText += `🔑 Contraseña Roblox: ${robloxPassword || 'N/A'}\n`;
    } else {
        messageText += `👤 ID de Jugador: *${playerId || 'N/A'}*\n`;
    }
    messageText += `📦 Paquete: *${packageName}*\n`;
    messageText += `💰 Total a Pagar: *${finalPrice} ${currency}*\n`;
    messageText += `💳 Método de Pago: *${paymentMethod.replace('-', ' ').toUpperCase()}*\n`;
    messageText += `📧 Correo Cliente: ${email}\n`;
    if (whatsappNumber) {
        messageText += `📱 WhatsApp Cliente: ${whatsappNumber}\n`;
    }

    // Detalles específicos del método de pago
    if (paymentMethod === 'pago-movil') {
        messageText += `📞 Teléfono Pago Móvil: ${methodSpecificDetails.phone || 'N/A'}\n`;
        messageText += `📊 Referencia Pago Móvil: ${methodSpecificDetails.reference || 'N/A'}\n`;
    } else if (paymentMethod === 'binance') {
        messageText += `🆔 TXID Binance: ${methodSpecificDetails.txid || 'N/A'}\n`;
    } else if (paymentMethod === 'zinli') {
        messageText += `📊 Referencia Zinli: ${methodSpecificDetails.reference || 'N/A'}\n`;
    }

    // Botones inline para Telegram
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

        // --- Enviar comprobante de pago a Telegram si existe ---
        if (paymentReceiptFile && paymentReceiptFile.filepath) {
            console.log("DEBUG: Intentando enviar comprobante a Telegram.");
            console.log("DEBUG: Ruta del archivo:", paymentReceiptFile.filepath);
            console.log("DEBUG: Nombre original:", paymentReceiptFile.originalFilename);
            console.log("DEBUG: Tipo MIME:", paymentReceiptFile.mimetype);

            try {
                const fileBuffer = fs.readFileSync(paymentReceiptFile.filepath);
                console.log("DEBUG: Tamaño del archivo (bytes):", fileBuffer.length);

                const sendFileUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`;
                
                const formData = new FormData();
                formData.append('chat_id', TELEGRAM_CHAT_ID);
                
                // *** CORRECCIÓN: Crear un stream Readable a partir del Buffer ***
                const fileStream = new Readable();
                fileStream.push(fileBuffer);
                fileStream.push(null); // Indica el fin del stream

                formData.append('document', fileStream, { // Pasamos el stream
                    filename: paymentReceiptFile.originalFilename || 'comprobante_pago.jpg',
                    contentType: paymentReceiptFile.mimetype || 'application/octet-stream',
                    knownLength: fileBuffer.length // Importante para que FormData sepa el tamaño
                });
                // *** FIN DE CORRECCIÓN ***

                formData.append('caption', `Comprobante de pago para la transacción ${id_transaccion_generado}`);

                const response = await axios.post(sendFileUrl, formData, {
                    headers: formData.getHeaders()
                });
                console.log("Comprobante de pago enviado a Telegram. Respuesta:", response.data);
            } catch (fileSendError) {
                console.error("ERROR: Fallo al enviar el comprobante a Telegram.");
                if (fileSendError.response) {
                    console.error("Detalles del error de respuesta de Telegram:", fileSendError.response.data);
                    console.error("Estado del error de respuesta:", fileSendError.response.status);
                } else if (fileSendError.request) {
                    console.error("No se recibió respuesta de Telegram (la solicitud fue enviada):", fileSendError.request);
                } else {
                    console.error("Error al configurar la solicitud:", fileSendError.message);
                }
            }
        } else {
            console.log("DEBUG: No hay archivo de comprobante para enviar a Telegram o filepath no es válido.");
        }

        // --- Actualizar Transaction en Supabase con el Message ID de Telegram ---
        if (newTransactionData && telegramMessageResponse && telegramMessageResponse.data && telegramMessageResponse.data.result) {
            const { data: updatedData, error: updateError } = await supabase
                .from('transactions')
                .update({ telegram_message_id: telegramMessageResponse.data.result.message_id })
                .eq('id', newTransactionData.id);

            if (updateError) {
                console.error("Error al actualizar la transacción en Supabase con telegram_message_id:", updateError.message);
            } else {
                console.log("Transaction actualizada en Supabase con telegram_message_id:", telegramMessageResponse.data.result.message_id);
            }
        }

    } catch (telegramError) {
        console.error("Error al enviar mensaje de Telegram o comprobante:", telegramError.response ? telegramError.response.data : telegramError.message);
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

        let playerInfoEmail = '';
        // NUEVO: Añadir detalles de Roblox al correo si corresponde
        if (game === 'Roblox') {
            playerInfoEmail = `
                <li><strong>Correo de Roblox:</strong> ${robloxEmail}</li>
                <li><strong>Contraseña de Roblox:</strong> ${robloxPassword}</li>
            `;
        } else {
            playerInfoEmail = playerId ? `<li><strong>ID de Jugador:</strong> ${playerId}</li>` : '';
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
                        ${playerInfoEmail}
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

        // NOTA: La sección para adjuntar el comprobante al correo ha sido removida
        // porque la lógica ahora prioriza enviarlo a Telegram.

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

    // --- Limpieza del archivo temporal después de todo procesamiento ---
    if (paymentReceiptFile && paymentReceiptFile.filepath && fs.existsSync(paymentReceiptFile.filepath)) {
        try {
            fs.unlinkSync(paymentReceiptFile.filepath);
            console.log("Archivo temporal del comprobante eliminado al finalizar la función.");
        } catch (unlinkError) {
            console.error("Error al eliminar el archivo temporal del comprobante:", unlinkError);
        }
    }

    return {
        statusCode: 200,
        body: JSON.stringify({ message: "Solicitud de pago recibida exitosamente. ¡Te enviaremos una confirmación pronto!" }),
    };
};