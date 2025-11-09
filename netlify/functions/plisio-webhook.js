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
    // 🚨 CORRECCIÓN 1: El hash se recibe en el campo 'secret', no 'verify_hash'
    const receivedHash = data.get('secret'); 
    
    const invoiceID = data.get('txn_id'); // Este es el ID de Transacción que usaremos
    const status = data.get('status');
    
    // --- 1. VERIFICACIÓN DE SEGURIDAD ---
    const keys = Array.from(data.keys())
        // 🚨 CORRECCIÓN 2: Filtrar 'secret' (el hash que recibimos) y 'api_key'
        .filter(key => key !== 'secret' && key !== 'api_key') 
        .sort();
        
    let hashString = '';
    keys.forEach(key => {
        hashString += data.get(key);
    });
    hashString += PLISIO_API_KEY; 
    
    // 🚨 CORRECCIÓN 3: Plisio usa SHA1, no MD5
    const generatedHash = crypto.createHash('sha1').update(hashString).digest('hex');

    if (generatedHash !== receivedHash) {
        console.error("ERROR: Firma de Webhook de Plisio INVÁLIDA.");
        // Devolvemos 200 OK para evitar que Plisio siga reintentando
        return { statusCode: 200, body: `Invalid Plisio Hash.` }; 
    }
    
    console.log("Webhook de Plisio verificado exitosamente.");
    
    // --- 2. PROCESAMIENTO DEL PAGO CONFIRMADO ---
    
    // Plisio usa 'completed' o 'amount_check' para pagos exitosos.
    if (status !== 'completed' && status !== 'amount_check') {
        console.log(`Evento de Plisio recibido, estado: ${status}. No se requiere acción de orden.`);
        return { statusCode: 200, body: "Webhook processed, not a completion event" };
    }
    
    console.log(`Pago CONFIRMADO para la orden: ${invoiceID}`);
    
    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        let transactionData;
        
        // a) BUSCAR LA TRANSACCIÓN EN SUPABASE (por el ID_TRANSACCION)
        const { data: transactions, error: fetchError } = await supabase
            .from('transactions')
            .select('*')
            .eq('id_transaccion', invoiceID)
            .single();

        if (fetchError || !transactions) {
             console.error(`ERROR: No se encontró la transacción con id_transaccion: ${invoiceID}. Deteniendo el proceso.`, fetchError);
             // Devolvemos 200 para no reintentar, pero se requiere revisión manual.
             return { statusCode: 200, body: "Transaction not found." };
        }
        
        transactionData = transactions;
        
        // b) ACTUALIZAR EL ESTADO DE LA TRANSACCIÓN
        const { error: updateError } = await supabase
            .from('transactions')
            .update({ 
                status: 'CONFIRMADO', 
                paymentMethod: `PLISIO (${data.get('currency_in')})`, // Actualizar el método
                methodDetails: {
                    plisio_txn_id: data.get('txn_id'),
                    plisio_currency_in: data.get('currency_in'),
                    plisio_amount: data.get('amount')
                }
            })
            .eq('id_transaccion', invoiceID);

        if (updateError) {
             console.error("Error al actualizar el estado de la transacción en Supabase:", updateError.message);
             // Continuamos, pero con advertencia.
        }

        // c) PREPARAR Y ENVIAR LA NOTIFICACIÓN DETALLADA A TELEGRAM (Lógica de process-payment.js)
        
        // El 'cartDetails' está guardado como un JSON string en Supabase
        let cartItems = [];
        if (transactionData.cartDetails) {
            try {
                // El campo cartDetails en la BD debería ser JSONB. Si es TEXT, necesita parseo.
                cartItems = JSON.parse(transactionData.cartDetails); 
            } catch (e) {
                console.error("Error al parsear cartDetails de la BD:", e);
            }
        }
        
        const finalPrice = transactionData.finalPrice || data.get('amount');
        const currency = transactionData.currency || 'USD';
        
        let messageText = `✅ ¡PAGO POR PASARELA CONFIRMADO! (Plisio) ✅\n\n`;
        messageText += `*ID de Transacción:* \`${invoiceID || 'N/A'}\`\n`;
        messageText += `*Estado:* \`CONFIRMADO\`\n`;
        messageText += `------------------------------------------------\n`;

        // Iterar sobre los productos del carrito para el detalle
        cartItems.forEach((item, index) => {
            messageText += `*📦 Producto ${index + 1}:*\n`;
            messageText += `🎮 Juego/Servicio: *${item.game || 'N/A'}*\n`;
            messageText += `📦 Paquete: *${item.packageName || 'N/A'}*\n`;
            
            // Lógica de impresión de credenciales y IDs
            if (item.game === 'Roblox') {
                messageText += `📧 Correo Roblox: ${item.robloxEmail || 'N/A'}\n`;
                messageText += `🔑 Contraseña Roblox: ${item.robloxPassword || 'N/A'}\n`;
            } else if (item.game === 'Call of Duty Mobile') {
                messageText += `📧 Correo CODM: ${item.codmEmail || 'N/A'}\n`;
                messageText += `🔑 Contraseña CODM: ${item.codmPassword || 'N/A'}\n`;
                messageText += `🔗 Vinculación CODM: ${item.codmVinculation || 'N/A'}\n`;
            } else if (item.playerId) {
                messageText += `👤 ID de Jugador: *${item.playerId}*\n`;
            }
            
            // Mostrar precio individual (si está disponible)
            const itemPrice = item.currency === 'VES' ? item.priceVES : item.priceUSD;
            const itemCurrency = item.currency || 'USD';
            if (itemPrice) {
                messageText += `💲 Precio (Est.): ${parseFloat(itemPrice).toFixed(2)} ${itemCurrency}\n`;
            }
            
            messageText += `------------------------------------------------\n`;
        });

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

        // e) Enviar Correo de Confirmación al Cliente (Opcional, pero recomendado)
        if (transactionData.email) {
             // ... Lógica de Nodemailer adaptada para CONFIRMACIÓN DE PAGO ...
             // Puedes usar una plantilla de correo más simple aquí.
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
        // Si hay un error, el log en Netlify es crucial para la depuración.
    }

    // SIEMPRE devolver 200 OK para indicarle a Plisio que el webhook fue recibido
    return { statusCode: 200, body: "Webhook processed" };
};

//https://es.pornhub.com/view_video.php?viewkey=68f009f85f328