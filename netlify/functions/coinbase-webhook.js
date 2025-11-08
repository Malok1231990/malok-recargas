// netlify/functions/coinbase-webhook.js
const { Client, Webhook } = require('coinbase-commerce-node');
// Se asume que también usarás axios, nodemailer y supabase si procesas la orden.
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const axios = require('axios'); // Para la notificación a Telegram

// Las variables de entorno para Supabase, SMTP y Telegram se leen aquí
// Debes asegurarte de tener: COINBASE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY, TELEGRAM_CHAT_ID, TELEGRAM_BOT_TOKEN, y las variables de SMTP.

exports.handler = async (event, context) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // --- Variables de Entorno ---
    const COINBASE_WEBHOOK_SECRET = process.env.COINBASE_WEBHOOK_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    // ... (otras variables de Telegram/SMTP para la notificacion final)

    if (!COINBASE_WEBHOOK_SECRET) {
        return { statusCode: 500, body: "Falta COINBASE_WEBHOOK_SECRET." };
    }
    
    // El cuerpo del evento (payload) y la firma de Coinbase
    const rawBody = event.body;
    const signature = event.headers['x-cc-webhook-signature'];
    let eventPayload;

    try {
        // 1. Verificar la firma del Webhook por seguridad
        // Si no pasa, se lanza un error y el webhook devuelve 400/401
        eventPayload = Webhook.verifyEventBody(
            rawBody, 
            signature, 
            COINBASE_WEBHOOK_SECRET
        );

        console.log("Webhook verificado y decodificado. Tipo:", eventPayload.type);
        
        // 2. Procesar solo los eventos de pago completado
        if (eventPayload.type === 'charge:confirmed') {
            const charge = eventPayload.data;
            const status = charge.timeline.find(t => t.status === 'CONFIRMED');
            
            if (!status) {
                console.log(`Charge ID ${charge.id} recibido, pero aún no está confirmado. Saltando.`);
                return { statusCode: 200, body: "Evento recibido, no requiere acción inmediata." };
            }

            const { metadata } = charge;
            
            // --- INICIA AQUÍ TU LÓGICA DE PROCESAMIENTO DE ORDEN ---
            
            console.log(`Pago CONFIRMADO para la orden de ${metadata.customer_email}`);
            
            // 3. INTEGRAR CON SUPABASE Y TELEGRAM/EMAIL (Misma lógica que process-payment.js)
            
            // Aquí debes:
            // a) Insertar la orden en tu tabla de "transacciones" en Supabase con estado "Pagado/Confirmado".
            // b) Notificar a Telegram con los detalles de la orden (leídos de metadata.cart_details).
            // c) Enviar el correo electrónico de confirmación de pago al cliente (metadata.customer_email).
            
            // Reutiliza la lógica de Supabase y notificación de tu archivo 'process-payment.js' aquí.

            // --- FIN DE LÓGICA DE PROCESAMIENTO DE ORDEN ---
        }

        // Devolver 200 para indicarle a Coinbase que el webhook fue recibido
        return { statusCode: 200, body: "Webhook processed" };

    } catch (error) {
        console.error("Error al procesar el Webhook de Coinbase:", error.message);
        // Devolver 400 para que Coinbase lo reintente o marque como fallido
        return { statusCode: 400, body: `Error de Webhook: ${error.message}` };
    }
};