// netlify/functions/plisio-webhook.js
const crypto = require('crypto');
const { URLSearchParams } = require('url');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const nodemailer = require('nodemailer'); 

exports.handler = async (event, context) => {
    // 🚨 TRAZA 0: Verificamos si la función empieza a ejecutarse.
    console.log("TRAZA 0: Webhook recibido. Verificando método..."); 
    
    if (event.httpMethod !== "POST") {
        console.log(`TRAZA 0.1: Método incorrecto: ${event.httpMethod}. Retornando 405.`);
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
        console.error("TRAZA 0.2: Faltan variables de entorno esenciales.");
        return { statusCode: 500, body: "Error de configuración." };
    }
    
    // --- 🔑 FIX CRÍTICO: Decodificación Base64 del Body ---
    let requestBody = event.body;
    console.log(`TRAZA 1: event.isBase64Encoded es: ${event.isBase64Encoded}.`);
    
    if (event.isBase64Encoded) {
        try {
            requestBody = Buffer.from(event.body, 'base64').toString('utf8');
            console.log("TRAZA 1.1: Body decodificado de Base64 exitosamente."); 
        } catch (e) {
            console.error("TRAZA 1.2: ERROR FATAL al decodificar Base64.", e);
            return { statusCode: 500, body: "Failed to decode body." };
        }
    }
    
    console.log(`TRAZA 2: Body (decodificado/raw) para URLSearchParams: ${requestBody.substring(0, 100)}...`);

    // Parseamos el cuerpo (URL-encoded) en un objeto URLSearchParams
    const data = new URLSearchParams(requestBody);

    // Creamos el objeto 'body' para mantener la compatibilidad con el resto del código
    const body = {};
    for (const [key, value] of data.entries()) {
        body[key] = value;
    }
    
    // --- OBTENCIÓN DE DATOS CRÍTICOS (Usando data.get()) ---
    const receivedHash = data.get('secret'); 
    const invoiceID = data.get('txn_id'); 
    const status = data.get('status');

    console.log(`TRAZA 3: Variables de Plisio obtenidas: ID=${invoiceID}, Status=${status}, Hash=${receivedHash ? receivedHash.substring(0, 5) + '...' : 'N/A'}`);
    
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

    console.log(`TRAZA 4: HashString (fragmento) para cálculo: ${hashString.substring(0, 50)}...`);
    
    const generatedHash = crypto.createHash('sha1').update(hashString).digest('hex');

    console.log(`TRAZA 5: Hash generado: ${generatedHash.substring(0, 10)}... | Hash recibido: ${receivedHash ? receivedHash.substring(0, 10) + '...' : 'N/A'}`);

    if (!invoiceID) {
        console.error("TRAZA 5.1: ERROR: No se pudo obtener el ID de Transacción (txn_id) de Plisio. Deteniendo.");
        return { statusCode: 200, body: "Missing Plisio txn_id." };
    }

    if (generatedHash !== receivedHash) {
        console.error(`TRAZA 6: ERROR: Firma de Webhook de Plisio INVÁLIDA para ID: ${invoiceID}.`);
        return { statusCode: 200, body: `Invalid Plisio Hash.` }; 
    }
    
    console.log(`TRAZA 7: Webhook de Plisio verificado exitosamente para ID: ${invoiceID}, Estado: ${status}`);
    
    // ----------------------------------------------------------------------
    // --- 2. PROCESAMIENTO DEL PAGO CONFIRMADO ---
    // ----------------------------------------------------------------------
    
    if (status !== 'completed' && status !== 'amount_check') {
        console.log(`TRAZA 8: Evento de Plisio recibido, estado: ${status}. No es un estado de éxito.`);
        
        let updateData = {};
        if (status === 'mismatch' || status === 'expired' || status === 'error') {
             updateData.status = `FALLO: ${status.toUpperCase()} (PLISIO)`;
        } else {
             // Ignoramos estados como 'waiting', 'pending'
             console.log("TRAZA 8.1: Estado intermedio o irrelevante. Fin.");
             return { statusCode: 200, body: "Webhook processed, no action needed for this status." };
        }
        
        try {
            console.log(`TRAZA 8.2: Actualizando estado de fallo en Supabase a: ${updateData.status}`);
            const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
            await supabase.from('transactions').update(updateData).eq('id_transaccion', invoiceID);
        } catch (e) {
            console.error("TRAZA 8.3: Error al actualizar estado intermedio:", e.message);
        }
        
        return { statusCode: 200, body: "Webhook processed, no completion event" };
    }
    
    console.log(`TRAZA 9: Pago CONFIRMADO para la orden: ${invoiceID}. Iniciando proceso de BD/Telegram.`);
    
    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
            auth: { persistSession: false },
        });
        let transactionData;
        
        // a) BUSCAR LA TRANSACCIÓN EN SUPABASE (por el ID_TRANSACCION)
        console.log(`TRAZA 10: Buscando transacción ${invoiceID} en Supabase.`);
        const { data: transactions, error: fetchError } = await supabase
            .from('transactions')
            .select('*')
            .eq('id_transaccion', invoiceID)
            .maybeSingle(); 

        if (fetchError) {
            console.error(`TRAZA 10.1: ERROR al buscar transacción en Supabase:`, fetchError);
            return { statusCode: 200, body: "DB Fetch Error." };
        }
        if (!transactions) {
             console.error(`TRAZA 10.2: ERROR: No se encontró la transacción con id_transaccion: ${invoiceID}. Deteniendo.`);
             return { statusCode: 200, body: "Transaction not found." };
        }
        
        transactionData = transactions;
        console.log(`TRAZA 11: Transacción encontrada. Email: ${transactionData.email}`);
        
        // b) ACTUALIZAR EL ESTADO DE LA TRANSACCIÓN
        console.log("TRAZA 12: Actualizando estado a 'CONFIRMADO' en Supabase.");
        const { error: updateError } = await supabase
            .from('transactions')
            .update({ 
                status: 'CONFIRMADO', 
                "paymentMethod": `PLISIO (${body.currency_in || 'N/A'})`, 
                "completed_at": new Date().toISOString(),
                "methodDetails": { 
                    plisio_txn_id: body.txn_id,
                    plisio_currency_in: body.currency_in,
                    plisio_amount: body.amount,
                    plisio_hash: receivedHash
                }
            })
            .eq('id_transaccion', invoiceID);

        if (updateError) {
             console.error("TRAZA 12.1: Error al actualizar el estado de la transacción:", updateError.message);
        }

        // c) PREPARAR Y ENVIAR LA NOTIFICACIÓN DETALLADA A TELEGRAM
        console.log("TRAZA 13: Preparando mensaje para Telegram.");
        
        let cartItems = [];
        if (transactionData.cartDetails && typeof transactionData.cartDetails === 'string') {
             try {
                 cartItems = JSON.parse(transactionData.cartDetails); 
                 console.log(`TRAZA 13.1: cartDetails parseado. Items: ${cartItems.length}`);
             } catch (e) {
                 console.error("TRAZA 13.2: Error al parsear cartDetails de la BD:", e);
             }
        } 
        
        if (!Array.isArray(cartItems) || cartItems.length === 0) {
             // Fallback
             cartItems = [{
                 game: transactionData.game,
                 packageName: transactionData.packageName,
                 playerId: transactionData.playerId,
                 finalPrice: transactionData.finalPrice,
                 currency: transactionData.currency
             }];
             console.log("TRAZA 13.3: ADVERTENCIA: Usando datos de compatibilidad (producto único) para el mensaje de Telegram.");
        }
        
        let messageText = `✅ *¡PAGO POR PASARELA CONFIRMADO!* (Plisio) ✅\n\n`;
        // ... (El resto de la construcción del mensaje permanece igual)

        // Iterar sobre los productos (o el producto único) para el detalle
        cartItems.forEach((item, index) => {
            if (item.game || item.packageName || item.playerId) {
                messageText += `*📦 Producto ${cartItems.length > 1 ? index + 1 : ''}:*\n`;
                
                const game = item.game || 'N/A';
                const packageName = item.packageName || 'N/A';
                const playerId = item.playerId || 'N/A';
                
                messageText += `🎮 Juego/Servicio: *${game}*\n`;
                messageText += `📦 Paquete: *${packageName}*\n`;
                
                const robloxEmail = item.roblox_email || transactionData.roblox_email;
                const robloxPassword = item.roblox_password || transactionData.roblox_password;
                const codmEmail = item.codm_email || transactionData.codm_email;
                const codmPassword = item.codm_password || transactionData.codm_password;
                const codmVinculation = item.codm_vinculation || transactionData.codm_vinculation;

                if (game && game.toLowerCase().includes('roblox') && robloxEmail && robloxPassword) {
                     messageText += `📧 Correo Roblox: \`${robloxEmail}\`\n`;
                     messageText += `🔑 Contraseña Roblox: \`${robloxPassword}\`\n`;
                } else if (game && game.toLowerCase().includes('duty mobile') && codmEmail && codmPassword) {
                     messageText += `📧 Correo CODM: \`${codmEmail}\`\n`;
                     messageText += `🔑 Contraseña CODM: \`${codmPassword}\`\n`;
                     messageText += `🔗 Vinculación CODM: ${codmVinculation || 'N/A'}\n`;
                } else if (playerId && playerId !== 'N/A') {
                     messageText += `👤 ID de Jugador: *${playerId}*\n`;
                }
                
                const itemPrice = item.priceUSD || item.finalPrice || 'N/A'; 
                const itemCurrency = item.currency || transactionData.currency || 'USD';

                if (itemPrice !== 'N/A' && itemCurrency !== 'N/A') {
                     messageText += `💲 Precio (Est.): ${parseFloat(itemPrice).toFixed(2)} ${itemCurrency}\n`;
                }
                
                messageText += `------------------------------------------------\n`;
            }
        });

        // Información de Pago y Contacto (Global)
        messageText += `\n*RESUMEN DE PAGO (Plisio)*\n`;
        messageText += `💰 *TOTAL PAGADO:* *${body.amount || 'N/A'} ${body.currency_out || 'N/A'}* (En ${body.currency_in || 'N/A'})\n`;
        messageText += `💳 Método de Pago: *PLISIO (${body.psys_cid || 'Cripto'})*\n`;
        messageText += `🆔 TXID Plisio: \`${body.txn_id || 'N/A'}\`\n`;
        
        messageText += `\n*DATOS DEL CLIENTE*\n`;
        messageText += `📧 Correo Cliente: ${transactionData.email || 'N/A'}\n`;
        if (transactionData.whatsappNumber) { 
             messageText += `📱 WhatsApp Cliente: ${transactionData.whatsappNumber}\n`;
        }


        // Botones inline para Telegram
        const replyMarkup = {
            inline_keyboard: [
                [{ text: "✅ Marcar como Realizada", callback_data: `mark_done_${invoiceID}` }]
            ]
        };

        const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        let telegramMessageResponse;
        
        console.log("TRAZA 14: Enviando mensaje a Telegram.");
        
        try {
            telegramMessageResponse = await axios.post(telegramApiUrl, {
                chat_id: TELEGRAM_CHAT_ID,
                text: messageText,
                parse_mode: 'Markdown',
                reply_markup: replyMarkup
            });
            console.log("TRAZA 14.1: Mensaje de Telegram de confirmación enviado con éxito.");
            
            // d) ACTUALIZAR EL message_id en Supabase
            if (telegramMessageResponse && telegramMessageResponse.data && telegramMessageResponse.data.result) {
                console.log("TRAZA 15: Actualizando Supabase con telegram_message_id.");
                await supabase
                    .from('transactions')
                    .update({ telegram_message_id: telegramMessageResponse.data.result.message_id })
                    .eq('id_transaccion', invoiceID);
                console.log("TRAZA 15.1: Transaction actualizada con telegram_message_id.");
            }

        } catch (telegramError) {
            console.error("TRAZA 14.2: ERROR: Fallo al enviar mensaje de Telegram.", telegramError.response ? telegramError.response.data : telegramError.message);
        }

        // e) Enviar Correo de Confirmación al Cliente (Si está configurado)
        if (transactionData.email && SMTP_HOST) {
             console.log("TRAZA 16: Enviando correo de confirmación al cliente.");
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
                 html: `<p>Hola,</p><p>Tu pago de ${body.amount || 'N/A'} ${body.currency_out || 'USD'} ha sido confirmado por la pasarela de Plisio. Tu recarga está siendo procesada por nuestro equipo.</p><p>Gracias por tu compra.</p>`,
             };
             
             await transporter.sendMail(mailOptions).catch(err => console.error("TRAZA 16.1: Error al enviar el correo de confirmación de Plisio:", err.message));
             console.log("TRAZA 17: Correo enviado/intento de envío completado.");
        }

    } catch (procError) {
        console.error("TRAZA 18: ERROR CRÍTICO durante el procesamiento de la orden de Plisio:", procError.message);
    }

    console.log("TRAZA FINAL: Webhook procesado. Retornando 200.");
    // SIEMPRE devolver 200 OK para indicarle a Plisio que el webhook fue recibido
    return { statusCode: 200, body: "Webhook processed" };
};