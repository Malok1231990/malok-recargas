// netlify/functions/process-payment.js
const axios = require('axios');
const { Formidable } = require('formidable');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const { Readable } = require('stream'); // Asegúrate de que este módulo esté importado

exports.handler = async function(event, context) {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    let data;
    let paymentReceiptFile; 

    // --- Configuración de Supabase ---
    // Asegúrate de que SUPABASE_URL y SUPABASE_SERVICE_KEY estén configuradas en tus variables de entorno de Netlify
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // --- Parsing de FormData con formidable ---
    const form = new Formidable({ multiples: true });

    // ¡CRÍTICO! Decodificar el body si es base64, como lo envía Netlify para multipart/form-data
    let bodyBuffer;
    if (event.isBase64Encoded) {
        bodyBuffer = Buffer.from(event.body, 'base64');
    } else {
        bodyBuffer = Buffer.from(event.body || ''); // Fallback seguro si no es base64 encoded
    }

    // Crear un stream Readable simulado para formidable
    const reqStream = new Readable();
    reqStream.push(bodyBuffer);
    reqStream.push(null); // Señaliza el fin del stream

    // Adjuntar headers y method al stream simulado, que formidable espera
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
            // Manejo para application/x-www-form-urlencoded si fuera necesario
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
    // Estos logs te mostrarán los valores que tu función está viendo en tiempo de ejecución.
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
    const SMTP_PORT = process.env.SMTP_PORT; // Será una cadena
    const SMTP_USER = process.env.SMTP_USER;
    const SMTP_PASS = process.env.SMTP_PASS;
    const SENDER_EMAIL = process.env.SENDER_EMAIL || SMTP_USER;

    // Validación de variables de entorno y puerto SMTP
    // parseInt(SMTP_PORT, 10) retornará NaN si SMTP_PORT no es un número, y NaN es falsy
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !SMTP_HOST || !parseInt(SMTP_PORT, 10) || !SMTP_USER || !SMTP_PASS || !supabaseUrl || !supabaseServiceKey) {
        console.error("Faltan variables de entorno requeridas o SMTP_PORT no es un número válido.");
        // Devuelve un error 500 para el cliente indicando un problema de configuración del servidor
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error de configuración del servidor: Faltan credenciales o configuración inválida." })
        };
    }

    // Extraer datos del formulario (ya procesados por formidable)
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
        id_transaccion_generado = `MALOK-${Date.now()}`; // Generar un ID único simple para la transacción

        const { data: insertedData, error: insertError } = await supabase
            .from('transactions') // Asegúrate de que 'transactions' es el nombre correcto de tu tabla en Supabase
            .insert({
                id_transaccion: id_transaccion_generado,
                game: game,
                playerId: playerId || null,
                packageName: packageName,
                finalPrice: parseFloat(finalPrice), // Convertir a número flotante
                currency: currency,
                paymentMethod: paymentMethod,
                email: email,
                whatsappNumber: whatsappNumber || null,
                methodDetails: methodSpecificDetails,
                status: 'pendiente', // Estado inicial de la transacción
                // timestamp: Supabase debería auto-generarlo con `now()` si está configurado así en la columna
                telegram_chat_id: TELEGRAM_CHAT_ID, // Guardar el chat ID de Telegram
                // telegram_message_id: null, // Se actualizará después de enviar el mensaje a Telegram
                receipt_url: paymentReceiptFile ? paymentReceiptFile.filepath : null // Guardar la ruta temporal del comprobante
            })
            .select(); // Retorna los datos insertados

        if (insertError) {
            throw insertError;
        }
        newTransactionData = insertedData[0]; // Supabase devuelve un array, toma el primer elemento
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
    messageText += `👤 ID de Jugador: *${playerId || 'N/A'}*\n`;
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

        // --- Actualizar Transaction en Supabase con el Message ID de Telegram ---
        // Esto es crucial para que la función webhook pueda identificar el mensaje.
        if (newTransactionData && telegramMessageResponse && telegramMessageResponse.data && telegramMessageResponse.data.result) {
            const { data: updatedData, error: updateError } = await supabase
                .from('transactions')
                .update({ telegram_message_id: telegramMessageResponse.data.result.message_id })
                .eq('id', newTransactionData.id); // Usar el 'id' generado por Supabase para la actualización

            if (updateError) {
                console.error("Error al actualizar la transacción en Supabase con telegram_message_id:", updateError.message);
            } else {
                console.log("Transaction actualizada en Supabase con telegram_message_id:", telegramMessageResponse.data.result.message_id);
            }
        }

    } catch (telegramError) {
        console.error("Error al enviar mensaje de Telegram:", telegramError.response ? telegramError.response.data : telegramError.message);
    }

    // --- Enviar Confirmación por Correo Electrónico al Cliente (con Nodemailer) ---
    if (email) {
        let transporter;
        try {
            transporter = nodemailer.createTransport({
                host: SMTP_HOST,
                port: parseInt(SMTP_PORT, 10), // Asegurarse de que el puerto es un número
                secure: parseInt(SMTP_PORT, 10) === 465, // True si el puerto es 465 (SSL/TLS implícito), False para STARTTLS (puerto 587)
                auth: {
                    user: SMTP_USER,
                    pass: SMTP_PASS,
                },
                tls: {
                    rejectUnauthorized: false // Permite conexiones a servidores con certificados auto-firmados o inválidos (usar con precaución en producción)
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
                // Es crucial eliminar el archivo temporal después de usarlo para evitar fugas de memoria y espacio
                if (fs.existsSync(paymentReceiptFile.filepath)) {
                    fs.unlinkSync(paymentReceiptFile.filepath); 
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
        body: JSON.stringify({ message: "Solicitud de pago recibida exitosamente. ¡Te enviaremos una confirmación pronto!" }),
    };
};

// Temporal change para redeploy