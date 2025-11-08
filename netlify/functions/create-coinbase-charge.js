// netlify/functions/create-coinbase-charge.js

// 1. Importar el módulo completo y el objeto Client (para el init)
const coinbase = require('coinbase-commerce-node');
const Client = coinbase.Client;

// 2. Definimos la clase Charge accediendo a la estructura interna del módulo
// Esta es la solución más robusta para versiones problemáticas:
const Charge = coinbase.resources.Charge; // 👈 CORRECCIÓN CRÍTICA

exports.handler = async (event, context) => {
    console.log("--- INICIO DE EJECUCIÓN DE FUNCIÓN ---");

    // 🛑 0. Validar método HTTP
    if (event.httpMethod !== 'POST') {
        console.log(`INFO: Método no permitido: ${event.httpMethod}`);
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    
    const apiKey = process.env.COINBASE_COMMERCE_API_KEY;
    const siteUrl = process.env.NETLIFY_SITE_URL;
    console.log(`DEBUG: API Key cargada: ${!!apiKey}`);
    console.log(`DEBUG: Site URL cargada: ${!!siteUrl}`);

    // 1. Validar variables de entorno críticas
    if (!apiKey || !siteUrl) {
        console.error("ERROR: COINBASE_COMMERCE_API_KEY o NETLIFY_SITE_URL están faltando.");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración del servidor. Faltan credenciales." }) 
        };
    }

    try {
        // 🔑 Verificación y Configuración Inicial
        console.log("DEBUG: Intentando inicializar Coinbase Client con Client.init...");
        
        // 1. Verificar si la clase Charge existe antes de llamar a create.
        if (typeof Charge !== 'function' || !Charge.create) {
             console.error(`ERROR: La clase Charge no se encontró o no tiene el método 'create'. Tipo: ${typeof Charge}`);
             throw new Error("Coinbase Commerce no pudo cargar la clase de pago. Verifique la versión (1.0.4) y la estructura del módulo.");
        }

        // 2. Inicializamos el Client (configura la API key para la clase Charge importada)
        Client.init(apiKey); 
        console.log("DEBUG: Client.init() ejecutado exitosamente.");
        
    } catch (initError) {
        console.error("ERROR: Fallo en la inicialización de Coinbase:", initError.message);
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error interno del servicio de pago (Init)." }) 
        };
    }

    let data;
    try {
        console.log("DEBUG: Intentando parsear el cuerpo de la solicitud...");
        data = JSON.parse(event.body);
        console.log("DEBUG: Cuerpo de la solicitud parseado exitosamente.");
    } catch (parseError) {
        console.error("ERROR: Fallo al parsear JSON:", parseError.message);
        return { statusCode: 400, body: JSON.stringify({ message: 'Formato de cuerpo de solicitud inválido.' }) };
    }
    
    // Muestra los datos que se van a usar
    console.log(`DEBUG: Datos recibidos -> Amount: ${data.amount}, Email: ${data.email}`);

    try {
        const { amount, email, whatsapp, cartDetails } = data; 

        // 2. Validaciones básicas de la solicitud
        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0 || !email) {
            console.error("ERROR: Validaciones fallidas. Datos:", { amount, email });
            return { statusCode: 400, body: JSON.stringify({ message: 'Datos de transacción incompletos o inválidos.' }) };
        }
        
        // Aplicar comisión del 3%
        const feePercentage = 0.03; 
        const amountValue = parseFloat(amount);
        const amountWithFee = amountValue * (1 + feePercentage); 
        const finalAmountUSD = amountWithFee.toFixed(2);
        
        console.log(`DEBUG: Monto original: ${amountValue}`);
        console.log(`DEBUG: Monto final con comisión: ${finalAmountUSD} USD`);
        
        // 3. Crear la factura (Charge)
        console.log("DEBUG: Intentando crear el Charge en Coinbase...");
        // 🎯 Usamos la clase Charge importada directamente de coinbase.resources
        const charge = await Charge.create({ 
            name: "Recarga de Servicios Malok",
            description: "Pago por carrito de recargas - Malok Recargas",
            local_price: {
                amount: finalAmountUSD,
                currency: 'USD',
            },
            pricing_type: 'fixed_price',
            redirect_url: siteUrl, 
            cancel_url: `${siteUrl}/payment.html`, 
            metadata: {
                customer_email: email,
                customer_whatsapp: whatsapp,
                // Asegurar que cartDetails sea una cadena si es un objeto
                cart_details: typeof cartDetails === 'object' ? JSON.stringify(cartDetails) : cartDetails, 
                original_amount: amountValue.toFixed(2),
            },
        });
        console.log(`DEBUG: Charge creado exitosamente. ID: ${charge.id}`);

        // 4. Respuesta exitosa
        console.log("--- FINALIZACIÓN EXITOSA DE FUNCIÓN ---");
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chargeUrl: charge.hosted_url,
                chargeId: charge.id,
            }),
        };

    } catch (error) {
        console.error(`ERROR: Fallo al crear Coinbase Charge: ${error.message}`);
        console.error("ERROR DETALLADO (Stack):", error); 
        
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message: `Error al crear la factura de pago.`,
                details: error.message || 'Error desconocido al interactuar con Coinbase Commerce.'
            }),
        };
    }
};