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
    
    // Parseamos el cuerpo (URL-encoded)
    const data = new URLSearchParams(event.body);
    
    const receivedHash = data.get('secret'); 
    const invoiceID = data.get('txn_id'); // Usamos txn_id como ID de Supabase
    const status = data.get('status');
    
    // --- 1. VERIFICACIÓN DE SEGURIDAD (Hash de Plisio) ---
    const keys = Array.from(data.keys())
        // Filtrar 'secret' (el hash que recibimos) y 'api_key'
        .filter(key => key !== 'secret' && key !== 'api_key') 
        .sort();
        
    let hashString = '';
    keys.forEach(key => {
        hashString += data.get(key);
    });
    hashString += PLISIO_API_KEY; 
    
    const generatedHash = crypto.createHash('sha1').update(hashString).digest('hex');

    if (generatedHash !== receivedHash) {
        console.error(`ERROR: Firma de Webhook de Plisio INVÁLIDA para ID: ${invoiceID}.`);
        return { statusCode: 200, body: `Invalid Plisio Hash.` }; 
    }
    
    console.log(`Webhook de Plisio verificado exitosamente para ID: ${invoiceID}, Estado: ${status}`);
    
    // --- 2. PROCESAMIENTO DEL PAGO CONFIRMADO ---
    
    // Plisio usa 'completed' o 'amount_check' para pagos exitosos.
    if (status !== 'completed' && status !== 'amount_check') {
        console.log(`Evento de Plisio recibido, estado: ${status}. No se requiere acción de orden.`);
        // Actualizamos el estado de forma pasiva si es diferente de PENDIENTE
        let updateData = {};
        if (status === 'mismatch' || status === 'expired' || status === 'error') {
             updateData.status = `FALLO: ${status.toUpperCase()} (PLISIO)`;
             // No es un error crítico, devolvemos 200 a Plisio
        } else {
             // Ignoramos estados como 'waiting', 'pending'
             return { statusCode: 200, body: "Webhook processed, no action needed for this status." };
        }
        
        try {
            const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
            await supabase.from('transactions').update(updateData).eq('id_transaccion', invoiceID);
        } catch (e) {
            console.error("Error al actualizar estado intermedio:", e.message);
        }
        
        return { statusCode: 200, body: "Webhook processed, no completion event" };
    }
    
    console.log(`Pago CONFIRMADO para la orden: ${invoiceID}`);
    
    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
            auth: { persistSession: false },
        });
        let transactionData;
        
        // a) BUSCAR LA TRANSACCIÓN EN SUPABASE (por el ID_TRANSACCION)
        const { data: transactions, error: fetchError } = await supabase
            .from('transactions')
            .select('*')
            .eq('id_transaccion', invoiceID)
            .maybeSingle(); // Usamos maybeSingle ya que Plisio debería enviar una sola vez un ID

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
                paymentMethod: `PLISIO (${data.get('currency_in')})`, // Actualizar el método
                fecha_completado: new Date().toISOString(),
                methodDetails: { // Guardamos detalles de Plisio en un campo JSON
                    plisio_txn_id: data.get('txn_id'),
                    plisio_currency_in: data.get('currency_in'),
                    plisio_amount: data.get('amount'),
                    plisio_hash: receivedHash
                }
            })
            .eq('id_transaccion', invoiceID);

        if (updateError) {
             console.error("Error al actualizar el estado de la transacción en Supabase:", updateError.message);
        }

// --------------------------------------------------------------------------------------
// CÓDIGO MODIFICADO: Envío de NOTIFICACIÓN DETALLADA A TELEGRAM
// --------------------------------------------------------------------------------------

        // c) PREPARAR Y ENVIAR LA NOTIFICACIÓN DETALLADA A TELEGRAM
        
        let cartItems = [];
        if (transactionData.cartDetails) {
             try {
                 // Si cartDetails es un string JSON, lo parseamos
                 cartItems = JSON.parse(transactionData.cartDetails); 
             } catch (e) {
                 console.error("Error al parsear cartDetails de la BD:", e);
             }
        }
        
        let messageText = `✅ ¡PAGO POR PASARELA CONFIRMADO! (Plisio) ✅\n\n`;
        messageText += `*ID de Transacción (MALOK):* \`${invoiceID || 'N/A'}\`\n`;
        messageText += `*Estado:* \`CONFIRMADO\`\n`;
        messageText += `*Método de Pago:* \`PLISIO (${data.get('currency_in')})\`\n`;
        messageText += `💰 *TOTAL PAGADO (Plisio):* *${data.get('amount')} USD* (En ${data.get('currency_in')})\n`;
        messageText += `------------------------------------------------\n`;
        messageText += `*🛒 DETALLES DEL CARRITO/PRODUCTO*\n`;


        // Iterar sobre los productos del carrito para el detalle
        cartItems.forEach((item, index) => {
            messageText += `*📦 Producto ${index + 1}:*\n`;
            messageText += `🎮 Juego/Servicio: *${item.game || 'N/A'}*\n`;
            messageText += `📦 Paquete: *${item.packageName || 'N/A'}*\n`;
            
            // Lógica de impresión de credenciales y IDs
            if (item.game === 'Roblox' && item.robloxEmail && item.robloxPassword) {
                 messageText += `📧 Correo Roblox: \`${item.robloxEmail}\`\n`;
                 messageText += `🔑 Contraseña Roblox: \`${item.robloxPassword}\`\n`;
            } else if (item.game === 'Call of Duty Mobile' && item.codmEmail && item.codmPassword) {
                 messageText += `📧 Correo CODM: \`${item.codmEmail}\`\n`;
                 messageText += `🔑 Contraseña CODM: \`${item.codmPassword}\`\n`;
                 messageText += `🔗 Vinculación CODM: ${item.codmVinculation || 'N/A'}\n`;
            } else if (item.playerId) {
                 messageText += `👤 ID de Jugador: *${item.playerId}*\n`;
            }
            
            // Mostrar precio individual
            const itemPrice = item.priceUSD || item.priceVES; 
            const itemCurrency = item.currency || (item.priceUSD ? 'USD' : 'VES');
            if (itemPrice) {
                 messageText += `💲 Precio (Est.): ${parseFloat(itemPrice).toFixed(2)} ${itemCurrency}\n`;
            }
            
            messageText += `------------------------------------------------\n`;
        });

        // Información de la FILA COMPLETA DE SUPABASE (Campos de la tabla transactions)
        messageText += `\n*📄 DATOS COMPLETOS DE SUPABASE (Transactions)*\n`;
        messageText += `🆔 ID Fila Supabase (UUID): \`${transactionData.id}\`\n`;
        messageText += `📧 Email Cliente: ${transactionData.email || 'N/A'}\n`;
        messageText += `📱 WhatsApp Cliente: ${transactionData.whatsappNumber || 'N/A'}\n`;
        messageText += `💰 Precio Final Calculado: *${transactionData.finalPrice || 'N/A'} ${transactionData.currency || 'USD'}*\n`;
        messageText += `🎮 Juego/Servicio Principal: *${transactionData.game || 'N/A'}*\n`;
        messageText += `📦 Paquete Principal: *${transactionData.packageName || 'N/A'}*\n`;
        messageText += `👤 Player ID/ID Jugador: *${transactionData.playerId || 'N/A'}*\n`;
        // Credenciales
        messageText += `📧 Roblox Email: \`${transactionData.roblox_email || 'N/A'}\`\n`;
        messageText += `🔑 Roblox Password: \`${transactionData.roblox_password || 'N/A'}\`\n`;
        messageText += `📧 CODM Email: \`${transactionData.codm_email || 'N/A'}\`\n`;
        messageText += `🔑 CODM Password: \`${transactionData.codm_password || 'N/A'}\`\n`;
        messageText += `🔗 CODM Vinculación: ${transactionData.codm_vinculation || 'N/A'}\n`;
        // Fechas y detalles
        messageText += `🗓️ Creado en: ${new Date(transactionData.created_at).toLocaleString('es-VE')}\n`;
        messageText += `🆔 TXID Plisio: \`${data.get('txn_id') || 'N/A'}\`\n`;
        messageText += `(Detalles de Pago): \`${JSON.stringify(transactionData.methodDetails) || 'N/A'}\`\n`;
        

        // Botones inline para Telegram
        const replyMarkup = {
            inline_keyboard: [
                [{ text: "✅ Marcar como Realizada", callback_data: `mark_done_${invoiceID}` }]
            ]
        };
        
// --------------------------------------------------------------------------------------
// FIN DE CÓDIGO MODIFICADO
// --------------------------------------------------------------------------------------

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

        // e) Enviar Correo de Confirmación al Cliente (Si está configurado)
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

    // SIEMPRE devolver 200 OK para indicarle a Plisio que el webhook fue recibido
    return { statusCode: 200, body: "Webhook processed" };
};