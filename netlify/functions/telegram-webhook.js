// netlify/functions/telegram-webhook.js
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js'); // Importa Supabase
const nodemailer = require('nodemailer'); // También Nodemailer aquí para el segundo correo

exports.handler = async function(event, context) {
    // Solo procesar peticiones POST
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // Asegúrate de que las variables de entorno estén configuradas
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    const SMTP_HOST = process.env.SMTP_HOST;
    const SMTP_PORT = process.env.SMTP_PORT;
    const SMTP_USER = process.env.SMTP_USER;
    const SMTP_PASS = process.env.SMTP_PASS;
    const SENDER_EMAIL = process.env.SENDER_EMAIL || SMTP_USER;

    if (!TELEGRAM_BOT_TOKEN || !supabaseUrl || !supabaseServiceKey || !SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
        console.error("Faltan variables de entorno requeridas en telegram-webhook.");
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error de configuración del servidor." })
        };
    }

    // Inicializa el cliente de Supabase
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parsea el cuerpo del evento de Telegram
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        console.error("Error al parsear el cuerpo del evento:", e);
        return { statusCode: 400, body: "Bad Request: Invalid JSON" };
    }

    // Verifica si es un callback_query (un clic en un botón)
    if (body.callback_query) {
        const callbackQuery = body.callback_query;
        const chatId = callbackQuery.message.chat.id;
        const messageId = callbackQuery.message.message_id;
        const callbackData = callbackQuery.data;
        const fromUser = callbackQuery.from;
        const userName = fromUser.first_name || 'Alguien';

        console.log(`Callback recibido: ${callbackData} del usuario ${userName} en el chat ${chatId}`);

        // Responder al callback query para que el botón muestre un feedback de "cargando" y no se quede girando
        try {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                callback_query_id: callbackQuery.id,
                text: 'Procesando...',
                show_alert: false
            });
        } catch (answerError) {
            console.error('Error al responder al callback query:', answerError.response ? answerError.response.data : answerError.message);
        }

        // --- Lógica para "Marcar como Realizada" ---
        if (callbackData.startsWith('mark_done_')) {
            const transactionId = callbackData.replace('mark_done_', '');
            let transactionData;

            try {
                // 1. Buscar la transacción en Supabase por id_transaccion (o telegram_message_id)
                // Usaremos id_transaccion que es el que pasamos en callback_data
                const { data: fetchedData, error: fetchError } = await supabase
                    .from('transactions')
                    .select('*')
                    .eq('id_transaccion', transactionId)
                    .single(); // Esperamos un solo resultado

                if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 es "no rows found"
                    throw fetchError;
                }
                
                transactionData = fetchedData;

                if (!transactionData) {
                    console.warn(`Transacción ${transactionId} no encontrada en Supabase.`);
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: `❌ Error: Transacción ${transactionId} no encontrada.`,
                        reply_to_message_id: messageId
                    });
                    return { statusCode: 200, body: "OK" };
                }

                // 2. Actualizar el estado de la transacción en Supabase
                if (transactionData.status !== 'completada') { // Evitar actualizar si ya está completada
                    const { data: updatedData, error: updateError } = await supabase
                        .from('transactions')
                        .update({ 
                            status: 'completada', 
                            completed_by: userName, 
                            completed_at: new Date().toISOString() 
                        })
                        .eq('id', transactionData.id) // Actualizar usando el UUID de Supabase
                        .select(); // Devolver los datos actualizados

                    if (updateError) {
                        throw updateError;
                    }
                    transactionData = updatedData[0]; // Actualizamos transactionData con los datos recién actualizados
                    console.log(`Transacción ${transactionId} marcada como completada en Supabase.`);
                } else {
                    console.log(`Transacción ${transactionId} ya estaba completada. No se actualizó.`);
                }
                
                // 3. Editar el mensaje original en Telegram
                const originalText = callbackQuery.message.text;
                // Reemplazamos el estado de forma segura y añadimos el pie de página
                const newText = originalText.replace('Estado: `PENDIENTE`', `Estado: \`COMPLETADA\` ✅`) +
                                `\n\n_Recarga marcada por: ${userName} (${new Date().toLocaleTimeString()})_`;

                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                    chat_id: chatId,
                    message_id: messageId,
                    text: newText,
                    parse_mode: 'Markdown',
                    reply_markup: {} // Quita el botón
                });
                console.log(`Mensaje de Telegram editado para la transacción ${transactionId}.`);

                // --- Enviar el SEGUNDO correo de confirmación (Recarga Completada) ---
                if (transactionData.email) {
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
                        console.error("Error al crear el transportador de Nodemailer en webhook:", createTransportError);
                    }

                    const secondMailOptions = {
                        from: SENDER_EMAIL,
                        to: transactionData.email,
                        subject: `✅ ¡Tu Recarga de ${transactionData.game} ha sido Completada! - Malok Recargas`,
                        html: `
                            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                                <h2 style="color: #28a745;">¡Tu Recarga de ${transactionData.game} está Lista!</h2>
                                <p>Hola,</p>
                                <p>¡Tenemos excelentes noticias! Tu recarga de <strong>${transactionData.game}</strong> con ID: <strong>${transactionData.id_transaccion}</strong> ha sido <strong>procesada y completada</strong> por nuestro equipo.</p>
                                <p>Aquí están los detalles finales de tu recarga:</p>
                                <ul style="list-style: none; padding: 0;">
                                    <li><strong>Juego:</strong> ${transactionData.game}</li>
                                    ${transactionData.playerId ? `<li><strong>ID de Jugador:</strong> ${transactionData.playerId}</li>` : ''}
                                    <li><strong>Paquete Recargado:</strong> ${transactionData.packageName}</li>
                                    <li><strong>Monto Pagado:</strong> ${transactionData.finalPrice} ${transactionData.currency}</li>
                                    <li><strong>Método de Pago:</strong> ${transactionData.paymentMethod.replace('-', ' ').toUpperCase()}</li>
                                </ul>
                                <p>Ya deberías ver los diamantes/monedas en tu cuenta de juego.</p>
                                <p>¡Gracias por elegir Malok Recargas para tus necesidades de juego!</p>
                                <p style="font-size: 0.9em; color: #777;">Si tienes alguna pregunta o necesitas asistencia, no dudes en contactarnos a través de nuestro WhatsApp: <a href="https://wa.me/584126949631" style="color: #28a745; text-decoration: none;">+58 412 6949631</a></p>
                            </div>
                        `,
                    };

                    if (transporter) {
                        try {
                            await transporter.sendMail(secondMailOptions);
                            console.log("Segundo correo (recarga completada) enviado al cliente:", transactionData.email);
                        } catch (secondEmailError) {
                            console.error("Error al enviar el segundo correo:", secondEmailError.message);
                            if (secondEmailError.response) {
                                console.error("Detalles del error SMTP del segundo correo:", secondEmailError.response);
                            }
                        }
                    } else {
                        console.error("No se pudo enviar el segundo correo: Transportador de Nodemailer no disponible.");
                    }
                }

            } catch (error) {
                console.error("Error en el procesamiento del callback de Telegram:", error.message);
                // Si algo falla, se puede enviar un mensaje de error a Telegram para depuración
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    chat_id: chatId,
                    text: `❌ Error al procesar la recarga ${transactionId}: ${error.message}. Consulta los logs de Netlify.`,
                    reply_to_message_id: messageId
                });
            }
        }
    }

    return { statusCode: 200, body: "OK" };
};