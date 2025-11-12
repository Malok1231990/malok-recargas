const { createClient } = require('@supabase/supabase-js');

// 💡 Variables de entorno de Supabase
const supabaseUrl = process.env.SUPABASE_URL;
// Usamos la Service Key ya que estamos en el backend y necesitamos permisos de escritura/actualización
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY; 

if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Faltan variables de entorno de Supabase.");
    // Devolvemos un error 500 si la configuración del servidor es incorrecta
    return { 
        statusCode: 500, 
        body: JSON.stringify({ message: "Error de configuración del servidor. Faltan credenciales de Supabase." }) 
    };
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

exports.handler = async function(event, context) {
    // 1. Verificar el método (solo POST)
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: JSON.stringify({ message: "Method Not Allowed" }) };
    }

    // 2. Obtener y verificar el token de sesión (Custom Auth)
    const authHeader = event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // ❌ Este es el error que estabas viendo. 
        console.log("❌ ERROR 401: Falta el token Bearer.");
        return { 
            statusCode: 401, 
            body: JSON.stringify({ message: "No autorizado. Falta el token de sesión." }) 
        };
    }

    // Extraer el token de la cadena "Bearer <token>"
    const sessionToken = authHeader.substring(7);

    // 3. Obtener el cuerpo de la solicitud
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ message: "Formato de cuerpo inválido." }) };
    }
    
    // Validar los datos necesarios para la deducción
    const { 
        amountUSD, 
        email, 
        whatsapp, 
        cartDetails // Se asume que estos son necesarios para el registro de la transacción
    } = body;
    
    if (typeof amountUSD !== 'number' || amountUSD <= 0) {
        return { statusCode: 400, body: JSON.stringify({ message: "Monto de deducción inválido." }) };
    }

    // 4. Buscar usuario por el token de sesión (Verificación de sesión)
    try {
        const { data: userData, error: userError } = await supabase
            .from('usuarios')
            .select(`
                google_id, 
                nombre,
                saldos(saldo_usd)
            `)
            .eq('session_token', sessionToken) // 🔑 Búsqueda por el token de sesión
            .maybeSingle();

        if (userError || !userData) {
            console.error("Error/Usuario no encontrado con el sessionToken:", sessionToken, userError);
            // Devolver 401 si el token no es válido o no encuentra usuario
            return { 
                statusCode: 401, 
                body: JSON.stringify({ message: "Sesión inválida o expirada. Vuelva a iniciar sesión." }) 
            };
        }
        
        const googleId = userData.google_id;
        const currentBalance = userData.saldos ? parseFloat(userData.saldos.saldo_usd) : 0.00;

        // 5. Verificar saldo suficiente
        if (currentBalance < amountUSD) {
            console.log(`Saldo insuficiente para ${userData.nombre}. Actual: ${currentBalance}, Requerido: ${amountUSD}`);
            return {
                statusCode: 403, // Prohibido
                body: JSON.stringify({ message: "Saldo insuficiente en la billetera." })
            };
        }

        const newBalance = currentBalance - amountUSD;

        // =========================================================
        // === DEDUCCIÓN EN TRANSACCIÓN ===
        // =========================================================
        
        // 6. Actualizar saldo y registrar la transacción (se asume que Supabase maneja
        //    esta lógica con RLS y la estructura de las tablas)
        
        // --- A. Actualizar el saldo ---
        const { error: updateError } = await supabase
            .from('saldos')
            .update({ saldo_usd: newBalance.toFixed(2) })
            .eq('user_id', googleId); // La tabla saldos usa el google_id (user_id)

        if (updateError) {
            console.error("Error al actualizar saldo:", updateError);
            throw new Error("Error en la base de datos al deducir saldo.");
        }
        
        // --- B. Registrar la transacción (historial) ---
        const transactionData = {
            user_id: googleId,
            monto: -amountUSD, // Negativo para deducción
            tipo: 'pago_servicio',
            descripcion: 'Pago de servicio a ' + email,
            metadatos: { email, whatsapp, cartDetails } // Guardar detalles
        };

        const { error: transError } = await supabase
            .from('transacciones')
            .insert(transactionData);

        if (transError) {
            console.error("Error al registrar transacción:", transError);
            // Nota: El saldo ya se dedujo. Deberías tener un mecanismo
            // de compensación si el registro de la transacción falla.
            // Por ahora, solo logueamos el error y devolvemos éxito en el pago.
        }

        // 7. Éxito
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: "Deducción exitosa.",
                nuevo_saldo: newBalance.toFixed(2),
                usuario: userData.nombre
            }),
        };

    } catch (error) {
        console.error(`[NETLIFY FUNCTION] Error en deduct-wallet-balance: ${error.message}`);
        // Devolver un 500 (Internal Server Error) para errores de DB/lógica
        return {
            statusCode: 500,
            body: JSON.stringify({ message: error.message || "Error desconocido en el servidor al deducir saldo." }),
        };
    }
};