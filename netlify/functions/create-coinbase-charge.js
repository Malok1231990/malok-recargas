// netlify/functions/create-coinbase-charge.js

// Importar solo el módulo completo. Ya no desestructuramos.
const coinbase = require('coinbase-commerce-node');

// Accedemos a Client y Charge a través de las propiedades del módulo importado.
const Client = coinbase.Client;
const Charge = coinbase.resources.Charge; // 👈 OTRA VÍA (Depende de la versión)

// ❗ Opción más simple y compatible (Volvemos a tu intento original, ¡pero sin desestructurar!)
// const Client = coinbase.Client;
// let Charge; // Se asignará después de la inicialización si funciona.

// Dejaremos el código limpio usando la propiedad Charge del objeto Client, 
// lo cual es el comportamiento esperado de esta librería.

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

    let ChargeResource;
    try {
        console.log("DEBUG: Intentando inicializar Coinbase Client con Client.init...");
        
        // 1. Inicializamos el Client
        Client.init(apiKey); 
        console.log("DEBUG: Client.init() ejecutado exitosamente.");

        // 2. Accedemos al recurso Charge a través de la propiedad del Client
        ChargeResource = Client.Charge; 
        
        console.log(`DIAG: Tipo de ChargeResource (después de init): ${typeof ChargeResource}`);

        if (typeof ChargeResource !== 'function' || !ChargeResource.create) {
             console.error("ERROR: Client.Charge no es un constructor de función válido después de init.");
             throw new Error("El recurso Charge no se cargó correctamente. Verifique la versión de la librería.");
        }
        
    } catch (initError) {
        console.error("ERROR: Fallo en la inicialización de Coinbase:", initError.message);
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error interno del servicio de pago (Verifique API Key)." }) 
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
        // 🎯 Usamos ChargeResource, que fue asignado desde Client.Charge
        const charge = await ChargeResource.create({ 
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