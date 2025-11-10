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
    const body = {};
    for (const [key, value] of data.entries()) {
        body[key] = value;
    }
    
    // El ID de Transacción en Supabase es el campo 'id_transaccion'.
    const receivedHash = body.secret; 
    const invoiceID = body.txn_id; // Usamos txn_id como ID de Supabase
    const status = body.status;
    
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
        
        let updateData = {};
        if (status === 'mismatch' || status === 'expired' || status === 'error') {
             updateData.status = `FALLO: ${status.toUpperCase()} (PLISIO)`;
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
            .maybeSingle(); 

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
             console.error("Error al actualizar el estado de la transacción en Supabase:", updateError.message);
        }

        // c) PREPARAR Y ENVIAR LA NOTIFICACIÓN DETALLADA A TELEGRAM
        
        let cartItems = [];
        
        // 🚨 LOG para inspección
        console.log(`LOG CART (RAW): transactionData.cartDetails existe: ${!!transactionData.cartDetails}`);
        if (transactionData.cartDetails) {
            console.log(`LOG CART (RAW): Tipo de cartDetails: ${typeof transactionData.cartDetails}`);
            // Solo loguea un snippet para evitar logs excesivamente largos
            console.log(`LOG CART (RAW): Snippet: ${String(transactionData.cartDetails).substring(0, 150)}...`); 
        }

        if (Array.isArray(transactionData.cartDetails)) {
            // Caso 1: Supabase devolvió un array (JSONB)
            cartItems = transactionData.cartDetails;
            console.log(`LOG CART: 'cartDetails' encontrado y usado como Array. Items: ${cartItems.length}`);
        } else if (transactionData.cartDetails && typeof transactionData.cartDetails === 'string') {
             try {
                 // Caso 2: Supabase devolvió un string (Columna TEXT o JSONB leída como String)
                 cartItems = JSON.parse(transactionData.cartDetails); 
                 console.log(`LOG CART: 'cartDetails' encontrado como String y parseado. Items: ${cartItems.length}`);
             } catch (e) {
                 console.error("LOG CART: Error al parsear cartDetails de la BD. El string es inválido.", e);
             }
        } else if (transactionData.cartDetails) {
             console.warn(`LOG CART: 'cartDetails' encontrado, pero no es Array ni String. Tipo: ${typeof transactionData.cartDetails}.`);
        } else {
             console.warn("LOG CART: 'cartDetails' no encontrado en la fila de Supabase (null/undefined).");
        }


        // 💥 Se usa el fallback si no se pudo cargar el array del carrito.
        if (!Array.isArray(cartItems) || cartItems.length === 0) {
             // Si no hay cartDetails o falló el parseo, usamos los campos de la transacción directamente
             cartItems = [{
                game: transactionData.game,
                packageName: transactionData.packageName,
                playerId: transactionData.playerId,
                finalPrice: transactionData.finalPrice,
                currency: transactionData.currency
             }];
             console.log("ADVERTENCIA: Usando datos de compatibilidad (producto único) para el mensaje de Telegram.");
        }
        
        let messageText = `✅ *¡PAGO POR PASARELA CONFIRMADO!* (Plisio) ✅\n\n`;
        messageText += `*ID de Transacción:* \`${invoiceID || 'N/A'}\`\n`;
        messageText += `*Estado:* \`CONFIRMADO\`\n`;
        messageText += `------------------------------------------------\n`;

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
                 html: `<p>Hola,</p><p>Tu pago de ${body.amount || 'N/A'} ${body.currency_out || 'USD'} ha sido confirmado por la pasarela de Plisio. Tu recarga está siendo procesada por nuestro equipo.</p><p>Gracias por tu compra.</p>`,
             };
             
             await transporter.sendMail(mailOptions).catch(err => console.error("Error al enviar el correo de confirmación de Plisio:", err.message));
        }

    } catch (procError) {
        console.error("ERROR CRÍTICO durante el procesamiento de la orden de Plisio:", procError.message);
    }

    // SIEMPRE devolver 200 OK para indicarle a Plisio que el webhook fue recibido
    return { statusCode: 200, body: "Webhook processed" };
};