// netlify/functions/plisio-webhook.js
const crypto = require('crypto');
const { URLSearchParams } = require('url');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const nodemailer = require('nodemailer');

exports.handler = async (event, context) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // --- Variables de Entorno ---
    const PLISIO_API_KEY = process.env.PLISIO_API_KEY; 
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const SMTP_HOST = process.env.SMTP_HOST;
    const SMTP_PORT = process.env.SMTP_PORT;
    const SMTP_USER = process.env.SMTP_USER;
    const SMTP_PASS = process.env.SMTP_PASS;
    const SENDER_EMAIL = process.env.SENDER_EMAIL || SMTP_USER;

    if (!PLISIO_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.error("Faltan variables de entorno esenciales.");
        return { statusCode: 500, body: "Error de configuración." };
    }
    
    const data = new URLSearchParams(event.body);
    const receivedHash = data.get('verify_hash');
    const invoiceID = data.get('txn_id');
    const status = data.get('status');
    
    // --- 1. VERIFICACIÓN DE SEGURIDAD ---
    const keys = Array.from(data.keys())
        .filter(key => key !== 'verify_hash' && key !== 'api_key')
        .sort();
        
    let hashString = '';
    keys.forEach(key => {
        hashString += data.get(key);
    });
    hashString += PLISIO_API_KEY; 
    const generatedHash = crypto.createHash('md5').update(hashString).digest('hex');

    if (generatedHash !== receivedHash) {
        console.error("ERROR: Firma de Webhook de Plisio INVÁLIDA.");
        return { statusCode: 401, body: `Invalid Plisio Hash.` }; 
    }
    
    console.log("Webhook de Plisio verificado exitosamente.");
    
    // --- 2. PROCESAMIENTO DEL PAGO CONFIRMADO ---
    
    if (status !== 'completed' && status !== 'amount_check') {
        console.log(`Evento de Plisio recibido, estado: ${status}. No se requiere acción de orden.`);
        return { statusCode: 200, body: "Webhook processed, not a completion event" };
    }
    
    console.log(`Pago CONFIRMADO para la orden: ${invoiceID}`);
    
    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        let transactionData;
        
        // a) BUSCAR LA TRANSACCIÓN EN SUPABASE
        const { data: transactions, error: fetchError } = await supabase
            .from('transactions')
            .select('*')
            .eq('id_transaccion', invoiceID)
            .single();

        if (fetchError || !transactions) {
             console.error(`ERROR: No se encontró la transacción con id_transaccion: ${invoiceID}. Deteniendo el proceso.`, fetchError);
             return { statusCode: 200, body: "Transaction not found." };
        }
        
        transactionData = transactions;
        
        // b) ACTUALIZAR EL ESTADO DE LA TRANSACCIÓN
        const { error: updateError } = await supabase
            .from('transactions')
            .update({ 
                status: 'CONFIRMADO', 
                paymentMethod: `PLISIO (${data.get('currency_in')})`,
                methodDetails: {
                    plisio_txn_id: data.get('txn_id'),
                    plisio_currency_in: data.get('currency_in'),
                    plisio_amount: data.get('amount')
                }
            })
            .eq('id_transaccion', invoiceID);

        if (updateError) {
             console.error("Error al actualizar el estado de la transacción en Supabase:", updateError.message);
        }

        // c) PREPARAR Y ENVIAR LA NOTIFICACIÓN DETALLADA A TELEGRAM
        
        // 🚨 CAMBIO CLAVE: Usamos los campos individuales de la fila, como el proceso manual.
        const { game, packageName, playerId, roblox_email, roblox_password, codm_email, codm_password, codm_vinculation } = transactionData;
        
        let messageText = `✅ ¡PAGO POR PASARELA CONFIRMADO! (Plisio) ✅\n\n`;
        messageText += `*ID de Transacción:* \`${invoiceID || 'N/A'}\`\n`;
        messageText += `*Estado:* \`CONFIRMADO\`\n`;
        messageText += `------------------------------------------------\n`;

        // Detalles del Producto (basado en el patrón de la tabla)
        messageText += `*📦 Producto Solicitado:*\n`;
        messageText += `🎮 Juego/Servicio: *${game || 'N/A'}*\n`;
        messageText += `📦 Paquete: *${packageName || 'N/A'}*\n`;
        
        if (playerId) {
            messageText += `👤 ID de Jugador: *${playerId}*\n`;
        }
        
        // Lógica de impresión de credenciales
        if (game === 'Roblox' && roblox_email) {
            messageText += `📧 Correo Roblox: ${roblox_email}\n`;
            messageText += `🔑 Contraseña Roblox: ${roblox_password || 'N/A'}\n`;
        } else if (game === 'Call of Duty Mobile' && codm_email) {
            messageText += `📧 Correo CODM: ${codm_email}\n`;
            messageText += `🔑 Contraseña CODM: ${codm_password || 'N/A'}\n`;
            messageText += `🔗 Vinculación CODM: ${codm_vinculation || 'N/A'}\n`;
        }
        
        messageText += `------------------------------------------------\n`;

        // Información de Pago y Contacto (Global)
        messageText += `\n*RESUMEN DE PAGO (Plisio)*\n`;
        messageText += `💰 *TOTAL PAGADO:* *${data.get('amount')} USD* (En ${data.get('currency_in')})\n`;
        messageText += `💳 Método de Pago: *PASARELA PLISIO*\n`;
        messageText += `📧 Correo Cliente: ${transactionData.email || 'N/A'}\n`;
        if (transactionData.whatsappNumber) {
            messageText += `📱 WhatsApp Cliente: ${transactionData.whatsappNumber}\n`;
        }
        messageText += `🆔 TXID Plisio: ${data.get('txn_id') || 'N/A'}\n`;


        // Botones inline para Telegram
        const replyMarkup = {
            inline_keyboard: [
                [{ text: "✅ Marcar como Realizada", callback_data: `mark_done_${invoiceID}` }]
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
            console.log("Mensaje de Telegram de confirmación enviado con éxito.");
            
            // d) ACTUALIZAR EL message_id en Supabase
            if (telegramMessageResponse && telegramMessageResponse.data && telegramMessageResponse.data.result) {
                await supabase
                    .from('transactions')
                    .update({ telegram_message_id: telegramMessageResponse.data.result.message_id })
                    .eq('id_transaccion', invoiceID);
                console.log("Transaction actualizada con telegram_message_id.");
            }

        } catch (telegramError) {
            console.error("ERROR: Fallo al enviar mensaje de Telegram.", telegramError.response ? telegramError.response.data : telegramError.message);
        }

        // e) Enviar Correo de Confirmación al Cliente
        if (transactionData.email && SMTP_HOST) {
             const transporter = nodemailer.createTransport({
                 host: SMTP_HOST,
                 port: parseInt(SMTP_PORT, 10),
                 secure: parseInt(SMTP_PORT, 10) === 465,
                 auth: { user: SMTP_USER, pass: SMTP_PASS },
                 tls: { rejectUnauthorized: false }
             });
             
             const mailOptions = {
                 from: SENDER_EMAIL,
                 to: transactionData.email,
                 subject: `✅ ¡Pago CONFIRMADO! Tu pedido #${invoiceID} está en proceso.`,
                 html: `<p>Hola,</p><p>Tu pago de ${data.get('amount')} USD ha sido confirmado por la pasarela de Plisio. Tu recarga está siendo procesada por nuestro equipo.</p><p>Gracias por tu compra.</p>`,
             };
             
             await transporter.sendMail(mailOptions).catch(err => console.error("Error al enviar el correo de confirmación de Plisio:", err.message));
        }

    } catch (procError) {
        console.error("ERROR CRÍTICO durante el procesamiento de la orden de Plisio:", procError.message);
    }

    return { statusCode: 200, body: "Webhook processed" };
};