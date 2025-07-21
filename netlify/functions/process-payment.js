// netlify/functions/process-payment.js
const axios = require('axios');
const formidable = require('formidable'); // Necesitarás instalar formidable
const fs = require('fs'); // Node.js built-in module for file system operations
const { Blob } = require('buffer'); // Polyfill for Blob if running on older Node.js/Netlify environment without it globally

exports.handler = async function(event, context) {
    // Solo permitir POST requests
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // Asegurarse de que el Content-Type es multipart/form-data
    if (!event.headers['content-type'] || !event.headers['content-type'].includes('multipart/form-data')) {
        return {
            statusCode: 415,
            body: JSON.stringify({ message: "Unsupported Media Type. Expected multipart/form-data." })
        };
    }

    // Variables de entorno para el token del bot y el chat ID (MUY IMPORTANTE para seguridad)
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.error("Missing Telegram Bot Token or Chat ID environment variables.");
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Server configuration error. Telegram credentials not set." })
        };
    }

    return new Promise((resolve, reject) => {
        // formidable requires the raw body, so we need to pass event.body
        // Netlify's event.body for multipart/form-data comes as a base64 encoded string.
        // formidable expects a Buffer or stream, so we decode it.
        const decodedBody = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');

        const form = formidable({
            multiples: true,
            // Netlify functions run in a /tmp directory, which is writable.
            // formidable uses os.tmpdir() by default, which usually works.
            // If you encounter issues, you might explicitly set uploadDir: '/tmp'
        });

        form.parse(decodedBody, async (err, fields, files) => {
            if (err) {
                console.error("Error parsing form data:", err);
                return resolve({ // Use resolve for HTTP response
                    statusCode: 500,
                    body: JSON.stringify({ message: "Error parsing form data." })
                });
            }

            let transactionDetails;
            try {
                // formidable returns fields as arrays, so access the first element
                transactionDetails = JSON.parse(fields.transactionDetails[0]);
            } catch (parseError) {
                console.error("Error parsing transactionDetails:", parseError);
                return resolve({
                    statusCode: 400,
                    body: JSON.stringify({ message: "Invalid transaction details format." })
                });
            }

            const { game, playerId, package: packageName, finalPrice, currency } = transactionDetails;
            const paymentMethod = fields.paymentMethod[0]; // Assuming paymentMethod is a single value

            // Get the uploaded file
            const paymentReceiptFile = files.paymentReceipt ? files.paymentReceipt[0] : null;

            // Decision logic for requiring receipt based on game
            if (!paymentReceiptFile && game !== "TikTok") {
                return resolve({
                    statusCode: 400,
                    body: JSON.stringify({ message: "Payment receipt is required for this payment method." })
                });
            }

            // Construir el mensaje para Telegram (caption de la foto)
            let captionText = `✨ Nueva Recarga Malok Recargas ✨\n\n`;
            captionText += `🎮 Juego: *${game}*\n`;
            captionText += `👤 ID de Jugador: *${playerId || 'N/A'}*\n`; // Player ID might be optional for some games
            captionText += `📦 Paquete: *${packageName}*\n`;
            captionText += `💰 Total a Pagar: *${parseFloat(finalPrice).toFixed(2)} ${currency}*\n`;
            captionText += `💳 Método de Pago: *${paymentMethod.replace('-', ' ').toUpperCase()}*\n`;

            const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/`;

            try {
                if (game === "TikTok") {
                    // For TikTok, just send a message as per the frontend logic,
                    // as the receipt and data are handled via WhatsApp.
                    await axios.post(`${telegramApiUrl}sendMessage`, {
                        chat_id: TELEGRAM_CHAT_ID,
                        text: captionText + "\n\n_NOTA: Comprobante y datos de TikTok se envían por WhatsApp._",
                        parse_mode: 'Markdown'
                    });
                } else if (paymentReceiptFile) {
                    // Read the file content from the temporary path formidable saved it to
                    const fileContent = fs.readFileSync(paymentReceiptFile.filepath);

                    // Create a FormData instance compatible with axios for multipart/form-data
                    // Note: Node.js does not have a native FormData, so ensure your environment or a polyfill provides it.
                    // For Netlify Functions, if you're on a recent Node.js version, 'form-data' or 'fetch-blob' might be needed
                    // or a simpler Blob polyfill. I'm including `buffer`'s Blob.
                    const telegramFormData = new FormData(); // This FormData needs to be available in the Node.js environment
                    telegramFormData.append('chat_id', TELEGRAM_CHAT_ID);
                    telegramFormData.append('caption', captionText);
                    telegramFormData.append('parse_mode', 'Markdown');
                    // Append the file, using Blob to correctly mimic file upload
                    telegramFormData.append('photo', new Blob([fileContent], { type: paymentReceiptFile.mimetype }), paymentReceiptFile.originalFilename);

                    await axios.post(`${telegramApiUrl}sendPhoto`, telegramFormData, {
                        headers: telegramFormData.getHeaders ? telegramFormData.getHeaders() : { 'Content-Type': `multipart/form-data; boundary=${telegramFormData._boundary}` }, // Ensure correct content type for axios
                        maxBodyLength: Infinity, // Important for large files
                        maxContentLength: Infinity, // Important for large files
                    });

                    // Clean up the temporary file created by formidable
                    fs.unlinkSync(paymentReceiptFile.filepath);

                } // Else condition handled by initial `if (!paymentReceiptFile && game !== "TikTok")`

                resolve({
                    statusCode: 200,
                    body: JSON.stringify({ message: "Payment processed and notification sent!" })
                });

            } catch (error) {
                console.error("Error sending Telegram message:", error.response ? error.response.data : error.message);
                resolve({ // Use resolve for HTTP response
                    statusCode: 500,
                    body: JSON.stringify({ message: "Failed to send notification." })
                });
            }
        });
    });
};