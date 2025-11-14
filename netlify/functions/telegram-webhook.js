// netlify/functions/telegram-webhook.js
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const nodemailer = require('nodemailer'); // 📧 1. IMPORTACIÓN DE NODEMAILER

exports.handler = async (event, context) => {
    if (event.httpMethod !== "POST") {
        console.log("Method Not Allowed: Expected POST.");
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // --- Variables de Entorno y Cliente Supabase ---
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    
    // 🔑 NUEVAS VARIABLES DE CORREO (Se usan en la función auxiliar)
    const SMTP_HOST = process.env.SMTP_HOST;
    const SMTP_PORT = process.env.SMTP_PORT;
    const SMTP_USER = process.env.SMTP_USER;
    const SMTP_PASS = process.env.SMTP_PASS;

    // 🚨 VERIFICACIÓN DE TODAS LAS VARIABLES ESENCIALES
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !TELEGRAM_BOT_TOKEN || !SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
        console.error("FATAL ERROR: Faltan variables de entorno esenciales (DB, Telegram o SMTP).");
        return { statusCode: 500, body: "Error de configuración. Verifique SMTP y Supabase." };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const body = JSON.parse(event.body);

    // ----------------------------------------------------------------------
    // 🔑 PASO 1: OBTENER LA TASA DE CAMBIO DINÁMICA
    // ----------------------------------------------------------------------
    let EXCHANGE_RATE = 1.0; // Valor por defecto (si es USD o si falla la DB)
    
    try {
        const { data: configData, error: configError } = await supabase
            .from('configuracion_sitio')
            .select('tasa_dolar')
            .eq('id', 1) // Asumimos que la configuración está en el ID 1
            .maybeSingle();

        if (configError) {
            console.warn(`WARN DB: Fallo al obtener tasa de dólar. Usando tasa por defecto (1.0). Mensaje: ${configError.message}`);
        } else if (configData && configData.tasa_dolar > 0) {
            EXCHANGE_RATE = configData.tasa_dolar;
            console.log(`LOG: Tasa de dólar obtenida de DB: ${EXCHANGE_RATE}`);
        }
    } catch (e) {
        console.error("ERROR CRITICO al obtener configuración de DB:", e.message);
    }


    // ----------------------------------------------------------------------
    // 💡 LÓGICA CLAVE: Manejo de la consulta de Callback
    // ----------------------------------------------------------------------
    if (body.callback_query) {
        const callbackData = body.callback_query.data;
        const chatId = body.callback_query.message.chat.id;
        const messageId = body.callback_query.message.message_id;
        const originalText = body.callback_query.message.text;
        const transactionPrefix = 'mark_done_';
        
        if (callbackData.startsWith(transactionPrefix)) {
            const transactionId = callbackData.replace(transactionPrefix, '');
            const NEW_STATUS = 'REALIZADA'; 
            
            console.log(`LOG: Callback recibido: Intentando marcar transacción ${transactionId} como ${NEW_STATUS}.`);

            try {
                // 2. BUSCAR LA TRANSACCIÓN (SE AMPLIÓ EL SELECT)
                console.log(`LOG: Buscando datos para transacción ${transactionId} en tabla 'transactions'.`);
                const { data: transactionData, error: fetchError } = await supabase
                    .from('transactions')
                    .select('status, google_id, "finalPrice", currency, game, email_cliente, product_details') // <-- 🚨 ¡NUEVAS COLUMNAS PARA EL CORREO!
                    .eq('id_transaccion', transactionId)
                    .maybeSingle();

                if (fetchError || !transactionData) {
                    console.error(`ERROR DB: Fallo al buscar la transacción ${transactionId}.`, fetchError ? fetchError.message : 'No encontrada');
                    await sendTelegramAlert(TELEGRAM_BOT_TOKEN, chatId, `❌ <b>Error:</b> No se encontró la transacción ${transactionId}.`, messageId);
                    return { statusCode: 200, body: "Processed" };
                }

                const { 
                    status: currentStatus, 
                    google_id, 
                    "finalPrice": finalPrice, 
                    currency,
                    game,
                    email_cliente,      // <-- Cliente Email
                    product_details     // <-- Detalles del Producto
                } = transactionData;
                
                const IS_WALLET_RECHARGE = game === 'Recarga de Saldo';

                const amountInTransactionCurrency = parseFloat(finalPrice);
                let amountToInject = amountInTransactionCurrency;
                let injectionMessage = ""; 
                let updateDBSuccess = true; // Flag para rastrear el éxito de la inyección/actualización


                // -------------------------------------------------------------
                // 3. LÓGICA DE INYECCIÓN CONDICIONAL
                // -------------------------------------------------------------
                
                if (currentStatus === NEW_STATUS) {
                    injectionMessage = "\n\n⚠️ <b>NOTA:</b> La transacción ya estaba en estado 'REALIZADA'. El saldo no fue inyectado de nuevo.";
                } else {
                    
                    if (IS_WALLET_RECHARGE) { 

                        // PASO 3.1: LÓGICA CONDICIONAL DE CONVERSIÓN
                        if (currency === 'VES' || currency === 'BS') { 
                            if (EXCHANGE_RATE > 0) {
                                amountToInject = amountInTransactionCurrency / EXCHANGE_RATE;
                                console.log(`LOG: Moneda VES detectada. Convirtiendo ${amountInTransactionCurrency.toFixed(2)} VES a USD con tasa ${EXCHANGE_RATE}. Resultado: $${amountToInject.toFixed(2)} USD.`);
                            } else {
                                throw new Error("ERROR FATAL: El tipo de cambio (tasa_dolar) no es válido o es cero. No se puede convertir VES a USD.");
                            }
                        } 

                        // PASO 3.2: INYECCIÓN DE SALDO
                        if (!google_id || isNaN(amountToInject) || amountToInject <= 0) {
                            injectionMessage = `\n\n❌ <b>ERROR DE INYECCIÓN DE SALDO:</b> Datos incompletos (Google ID: ${google_id}, Monto: ${finalPrice}). <b>¡REVISIÓN MANUAL REQUERIDA!</b>`;
                            updateDBSuccess = false;
                        } else {
                            // 4. INYECTAR SALDO AL CLIENTE (Usando la función RPC)
                            console.log(`LOG: Intentando inyectar $${amountToInject.toFixed(2)} a 'user_id' ${google_id} usando RPC.`);
                            
                            try {
                                const { error: balanceUpdateError } = await supabase
                                    .rpc('incrementar_saldo', { 
                                        p_user_id: google_id, 
                                        p_monto: amountToInject.toFixed(2)
                                    }); 
                                    
                                if (balanceUpdateError) {
                                    console.error(`ERROR DB: Fallo al inyectar saldo a ${google_id}. Mensaje: ${balanceUpdateError.message}.`);
                                    injectionMessage = `\n\n❌ <b>ERROR CRÍTICO AL INYECTAR SALDO:</b> No se pudo actualizar la billetera del cliente (<code>${google_id}</code>). <br/>${balanceUpdateError.message}`;
                                    updateDBSuccess = false; 
                                    throw new Error("Fallo en la inyección de saldo.");
                                }
                                
                                console.log(`LOG: Inyección de saldo exitosa para ${google_id}.`);
                                injectionMessage = `\n\n💰 <b>INYECCIÓN DE SALDO EXITOSA:</b> Se inyectaron <b>$${amountToInject.toFixed(2)} USD</b> a la billetera del cliente (<code>${google_id}</code>).`;
                            } catch (e) {
                                console.error("ERROR CRITICO: Falló la llamada RPC para inyección de saldo.", e.message);
                                updateDBSuccess = false;
                                throw new Error(`Falló la inyección atómica (RPC). Error: ${e.message}`); // Propaga el error
                            }
                        }
                    } else {
                        // Si NO es 'Recarga de Saldo' (es un producto)
                        injectionMessage = `\n\n🛒 <b>PRODUCTO ENTREGADO ✅: No se requería inyección de saldo.</b>`;
                    }
                } 


                // 5. ACTUALIZACIÓN DEL ESTADO... (Solo si la inyección y el estado inicial fueron exitosos)
                if (currentStatus !== NEW_STATUS && updateDBSuccess) {
                    console.log(`LOG: Actualizando estado de transacción ${transactionId} a ${NEW_STATUS}.`);
                    const { error: updateError } = await supabase
                        .from('transactions')
                        .update({ 
                            status: NEW_STATUS
                        })
                        .eq('id_transaccion', transactionId)
                        .in('status', ['pendiente', 'CONFIRMADO']); 
                    
                    if (updateError) {
                        console.error(`ERROR DB: Fallo al actualizar el estado a ${NEW_STATUS}.`, updateError.message);
                        injectionMessage += `\n\n⚠️ <b>ADVERTENCIA:</b> Fallo al actualizar el estado de la transacción: ${updateError.message}`;
                        updateDBSuccess = false; // Si falla la actualización, cambiamos el flag para el mensaje final
                    }
                }
                
                // 5.5. 📧 LÓGICA DE ENVÍO DE CORREO DE FACTURA (NUEVA LÓGICA)
                if (currentStatus !== NEW_STATUS && updateDBSuccess && email_cliente) {
                    console.log(`LOG: Procediendo a generar y enviar factura por correo a ${email_cliente}.`);

                    const invoiceSubject = `✅ Factura de Pedido #${transactionId} - ${game}`;
                    
                    // Crea una lista HTML de los detalles del producto si product_details es un objeto.
                    const productDetailHtml = typeof product_details === 'object' && product_details !== null
                        ? Object.entries(product_details).map(([key, value]) => `<li><b>${key.charAt(0).toUpperCase() + key.slice(1)}:</b> ${value}</li>`).join('')
                        : '<li>No hay detalles de producto adicionales registrados.</li>';

                    const invoiceBody = `
                        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                            <h2 style="color: #28a745;">✅ Transacción REALIZADA y Confirmada</h2>
                            <p>¡Hola! Tu pedido <b>${transactionId}</b> ha sido procesado con éxito y marcado como <b>REALIZADO</b> por el operador.</p>
                            <hr style="border-top: 1px solid #eee;"/>
                            <h3 style="color: #007bff;">Resumen de la Factura:</h3>
                            <ul style="list-style: none; padding: 0;">
                                <li style="margin-bottom: 5px;"><b>ID Transacción:</b> <code>${transactionId}</code></li>
                                <li style="margin-bottom: 5px;"><b>Producto/Servicio:</b> ${game}</li>
                                <li style="margin-bottom: 5px;"><b>Monto Total Pagado:</b> <b>${parseFloat(finalPrice).toFixed(2)} ${currency}</b></li>
                                <li style="margin-bottom: 5px;"><b>Monto Inyectado (si aplica):</b> ${IS_WALLET_RECHARGE ? `$${amountToInject.toFixed(2)} USD` : 'N/A'}</li>
                            </ul>
                            <hr style="border-top: 1px solid #eee;"/>
                            <h4 style="color: #6c757d;">Detalles de la Transacción:</h4>
                            <ul style="list-style: none; padding: 0;">${productDetailHtml}</ul>
                            <p style="margin-top: 20px; font-size: 0.9em; color: #999;"><i>Este es un correo automático de confirmación de servicio.</i></p>
                        </div>
                    `;

                    // LLAMAR A LA FUNCIÓN DE ENVÍO
                    const emailSent = await sendInvoiceEmail(transactionId, email_cliente, invoiceSubject, invoiceBody);
                    
                    if (emailSent) {
                        injectionMessage += `\n\n📧 <b>CORREO ENVIADO:</b> Factura enviada a <code>${email_cliente}</code>.`;
                    } else {
                        injectionMessage += `\n\n⚠️ <b>ERROR DE CORREO:</b> No se pudo enviar la factura. Revisar logs SMTP.`;
                    }
                } else if (currentStatus !== NEW_STATUS && updateDBSuccess && !email_cliente) {
                    injectionMessage += `\n\n⚠️ <b>ADVERTENCIA:</b> No se pudo enviar el correo, la columna 'email_cliente' está vacía.`;
                }
                
                // Si ya estaba REALIZADA, aún se considera un éxito en el marcado
                const finalStatusText = (currentStatus === NEW_STATUS || updateDBSuccess) ? NEW_STATUS : 'ERROR CRÍTICO';
                const finalStatusEmoji = (currentStatus === NEW_STATUS || updateDBSuccess) ? '✅' : '❌';


                // 6. CONFIRMACIÓN Y EDICIÓN DEL MENSAJE DE TELEGRAM...
                console.log("LOG: Editando mensaje de Telegram.");
                
                const statusMarker = `\n\n------------------------------------------------\n` +
                                     `${finalStatusEmoji} <b>ESTADO FINAL: ${finalStatusText}</b>\n` +
                                     `<i>Marcada por operador a las: ${new Date().toLocaleTimeString('es-VE')}</i> \n` +
                                     `------------------------------------------------` +
                                     injectionMessage; 

                const newFullText = originalText + statusMarker;
                
                await editTelegramMessage(
                    TELEGRAM_BOT_TOKEN, chatId, messageId, 
                    newFullText, 
                    {}
                );
                
            } catch (e) {
                // Este 'catch' solo atrapa errores graves como fallo en la búsqueda o en la inyección (RPC)
                console.error("ERROR FATAL en callback_query handler (Catch block):", e.message);
                await editTelegramMessage(
                    TELEGRAM_BOT_TOKEN, chatId, messageId, 
                    `❌ <b>ERROR CRÍTICO EN PROCESO DE MARCADO</b> ❌<br/>Transacción: <code>${transactionId}</code><br/>Fallo: ${e.message}<br/><br/><b>¡REVISIÓN MANUAL URGENTE!</b>`,
                    {}
                );
            }
        }
    } 
    
    return { statusCode: 200, body: "Webhook processed" };
};


// ----------------------------------------------------------------------
// --- FUNCIONES AUXILIARES ---
// ----------------------------------------------------------------------

// 📧 NUEVA FUNCIÓN: Envío de correo con Nodemailer
async function sendInvoiceEmail(transactionId, userEmail, emailSubject, emailBody) {
    // 1. Configurar el transporter de Nodemailer usando las variables de entorno
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: process.env.SMTP_PORT == 465, // True si es 465, False para otros puertos
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        },
    });

    // 2. Configurar el contenido del correo
    const mailOptions = {
        from: process.env.SMTP_USER,
        to: userEmail,               
        subject: emailSubject,
        html: emailBody,             
    };

    // 3. Enviar el correo
    try {
        console.log(`LOG: Intentando enviar correo de factura para transacción ${transactionId} a ${userEmail}.`);
        let info = await transporter.sendMail(mailOptions);
        console.log(`LOG: Correo enviado. Message ID: ${info.messageId}`);
        return true;
    } catch (e) {
        console.error(`ERROR EMAIL: Fallo al enviar el correo de factura para ${transactionId}. Mensaje: ${e.message}`);
        // Detalle del error de SMTP si está disponible
        if (e.response && e.response.includes('authentication failed')) {
            console.error('ERROR SMTP DETALLE: Fallo de autenticación. Verifique SMTP_USER y SMTP_PASS.');
        }
        return false;
    }
}


// MODIFICADA: Ahora usa parse_mode: 'HTML'
async function editTelegramMessage(token, chatId, messageId, text, replyMarkup) {
    const telegramApiUrl = `https://api.telegram.org/bot${token}/editMessageText`;
    try {
        await axios.post(telegramApiUrl, {
            chat_id: chatId,
            message_id: messageId,
            text: text,
            parse_mode: 'HTML', 
            reply_markup: replyMarkup
        });
    } catch (error) {
        console.error("ERROR TELEGRAM: Fallo al editar mensaje de Telegram.", error.response ? error.response.data : error.message);
    }
}

// MODIFICADA: Ahora usa parse_mode: 'HTML'
async function sendTelegramAlert(token, chatId, text, replyToMessageId = null) {
    const telegramApiUrl = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
        await axios.post(telegramApiUrl, {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML', 
            reply_to_message_id: replyToMessageId 
        });
    } catch (error) {
        console.error("ERROR TELEGRAM: Fallo al enviar alerta de Telegram.", error.response ? error.response.data : error.message);
    }
}