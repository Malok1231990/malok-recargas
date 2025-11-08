// netlify/functions/plisio-webhook.js
// Paquetes necesarios: 'crypto' (nativo de Node), 'url' (nativo de Node), 
// '@supabase/supabase-js', 'nodemailer', 'axios' (para Telegram)

const crypto = require('crypto');
const { URLSearchParams } = require('url');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const axios = require('axios'); 

// Esta función reutiliza la lógica de notificación que ya tenías en tus funciones.
// Asegúrate de que las variables de entorno para Supabase, SMTP y Telegram 
// (SUPABASE_URL, SUPABASE_SERVICE_KEY, TELEGRAM_CHAT_ID, TELEGRAM_BOT_TOKEN, etc.) 
// estén configuradas en Netlify.

exports.handler = async (event, context) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // --- Variables de Entorno de Plisio ---
    // 🚨 Usamos la misma clave secreta que para crear la factura
    const PLISIO_API_KEY = process.env.PLISIO_API_KEY; 
    
    // --- Variables de Entorno para el Procesamiento Final ---
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    // ... (otras variables de SMTP)

    if (!PLISIO_API_KEY) {
        return { statusCode: 500, body: "Falta PLISIO_API_KEY." };
    }
    
    // Plisio envía los datos como application/x-www-form-urlencoded
    // Debemos parsear el cuerpo
    const data = new URLSearchParams(event.body);
    const receivedHash = data.get('verify_hash');
    
    // --- 1. VERIFICACIÓN DE SEGURIDAD (REEMPLAZO DE Webhook.verifyEventBody) ---
    
    // Obtener todas las claves excepto 'verify_hash' y 'api_key', y ordenarlas alfabéticamente
    const keys = Array.from(data.keys())
        .filter(key => key !== 'verify_hash' && key !== 'api_key')
        .sort();
        
    // Concatenar los valores de los parámetros en orden y añadir la clave secreta al final
    let hashString = '';
    keys.forEach(key => {
        hashString += data.get(key);
    });
    hashString += PLISIO_API_KEY; 

    // Generar el Hash MD5 y compararlo con el recibido
    const generatedHash = crypto.createHash('md5').update(hashString).digest('hex');

    if (generatedHash !== receivedHash) {
        console.error("ERROR: Firma de Webhook de Plisio INVÁLIDA. Hash recibido:", receivedHash, "Generado:", generatedHash);
        // Devolver 401 para que Plisio reintente si es necesario.
        return { statusCode: 401, body: `Invalid Plisio Hash.` }; 
    }
    
    console.log("Webhook de Plisio verificado exitosamente.");
    
    // --- 2. PROCESAMIENTO DEL PAGO CONFIRMADO ---
    
    const status = data.get('status');
    
    // Plisio usa 'completed' o 'amount_check' para pagos exitosos.
    if (status === 'completed' || status === 'amount_check') {
        
        const invoiceID = data.get('txn_id');
        let metadata;
        
        try {
            // El campo 'custom' (metadata) viene como JSON String en Plisio
            metadata = JSON.parse(data.get('custom')); 
        } catch (e) {
            console.error("Error al parsear el campo 'custom' de Plisio:", e.message);
            return { statusCode: 400, body: "Invalid metadata format" };
        }
        
        const { customer_email, cart_details } = metadata;

        console.log(`Pago CONFIRMADO para la orden ${invoiceID} de ${customer_email}`);
        
        // --- INICIA AQUÍ TU LÓGICA DE PROCESAMIENTO DE ORDEN (Mantenida) ---
        
        try {
            // a) Inicializar Supabase
            const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
            
            // b) Insertar la orden en tu tabla de "transacciones" en Supabase con estado "Pagado/Confirmado".
            const { data: insertData, error: insertError } = await supabase
                .from('transacciones')
                .insert([
                    {
                        // Asegúrate de que los nombres de columna coincidan con tu tabla
                        email: customer_email,
                        whatsapp: metadata.customer_whatsapp,
                        monto_original_usd: metadata.original_amount,
                        monto_final_plisio_usd: data.get('amount'),
                        metodo_pago: `PLISIO (${data.get('currency_in')})`, // e.g., PLISIO (BTC)
                        estado: 'CONFIRMADO',
                        detalles_carrito: cart_details,
                        referencia_pago: invoiceID,
                    }
                ]);

            if (insertError) throw new Error(`Supabase Insert Error: ${insertError.message}`);

            // c) Notificar a Telegram con los detalles de la orden (leídos de metadata.cart_details).
            const message = `🚨 NUEVA ORDEN CONFIRMADA (Plisio) 🚨\n\n` +
                            `ID Factura: ${invoiceID}\n` +
                            `Email: ${customer_email}\n` +
                            `Monto Pagado: ${data.get('amount')} USD en ${data.get('currency_in')}\n` +
                            `Detalles: ${JSON.stringify(JSON.parse(cart_details), null, 2)}`;
                            
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
            });

            // d) Enviar el correo electrónico de confirmación de pago al cliente (metadata.customer_email).
            // Lógica de Nodemailer (debes tener la configuración SMTP en variables de entorno)
            const transporter = nodemailer.createTransport({
                // Configuración SMTP...
            });
            
            const mailOptions = {
                from: process.env.SMTP_USER,
                to: customer_email,
                subject: '✅ Pago de Recarga Confirmado',
                html: `Hola ${customer_email},<br><br>Hemos recibido tu pago de ${data.get('amount')} USD y tu orden ${invoiceID} está siendo procesada.<br><br>Gracias por tu compra.`,
            };
            
            await transporter.sendMail(mailOptions);

            console.log("Procesamiento de orden finalizado: Supabase, Telegram, Email OK.");

        } catch (procError) {
            console.error("ERROR CRÍTICO durante el procesamiento de la orden (Supabase/Notificaciones):", procError.message);
            // Si el procesamiento falla, aún devolvemos 200 a Plisio para evitar reintentos de Webhook, 
            // pero se requiere intervención manual para esta orden.
        }

        // --- FIN DE LÓGICA DE PROCESAMIENTO DE ORDEN ---
    } else {
        console.log(`Evento de Plisio recibido, estado: ${status}. No se requiere acción de orden.`);
    }

    // Devolver 200 OK para indicarle a Plisio que el webhook fue recibido
    return { statusCode: 200, body: "Webhook processed" };
};