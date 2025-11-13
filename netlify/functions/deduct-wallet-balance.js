const { createClient } = require('@supabase/supabase-js');

// =================================================================
// 💡 CONFIGURACIÓN DE SUPABASE (FUERA DEL HANDLER para reuso)
// =================================================================

// Variables de entorno de Supabase
const supabaseUrl = process.env.SUPABASE_URL;
// Usamos la Service Key ya que estamos en el backend y necesitamos permisos de escritura/actualización
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY; 

let supabase = null;

if (supabaseUrl && supabaseServiceKey) {
    supabase = createClient(supabaseUrl, supabaseServiceKey);
}

// =================================================================
// 🔑 FUNCIÓN NETLIFY HANDLER
// =================================================================

exports.handler = async function(event, context) {
    
    // Verificar si la configuración de Supabase está disponible
    if (!supabase) {
        console.error("Faltan variables de entorno de Supabase.");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración del servidor. Faltan credenciales de Supabase." }) 
        };
    }
    
    // 1. Verificar el método (solo POST)
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: JSON.stringify({ message: "Method Not Allowed" }) };
    }

    // 2. Obtener y verificar el token de sesión (Custom Auth)
    const authHeader = event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log("❌ ERROR 401: Falta el token Bearer.");
        return { 
            statusCode: 401, 
            body: JSON.stringify({ message: "No autorizado. Falta el token de sesión." }) 
        };
    }
    
    const sessionToken = authHeader.split(' ')[1];

    // 3. Obtener el cuerpo de la solicitud
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ message: "Formato de cuerpo inválido." }) };
    }
    
    const { amountUSD, email, whatsapp, cartDetails } = body;
    
    // 4. Validar el monto
    const amount = parseFloat(amountUSD);

    if (isNaN(amount) || amount <= 0) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: "Monto de deducción inválido." })
        };
    }

    try {
        // A. Verificación del Token y obtención de googleId (usuario)
        const { data: userData, error: userError } = await supabase
            .from('usuarios')
            .select('google_id, nombre')
            .eq('session_token', sessionToken) // Busca el usuario por el token de sesión
            .maybeSingle();

        if (userError || !userData) {
            console.error("Token de sesión inválido o expirado:", userError?.message);
            return {
                statusCode: 401,
                body: JSON.stringify({ message: "Token de sesión inválido o expirado." })
            };
        }
        
        const googleId = userData.google_id;
        
        // B. Obtener Saldo Actual
        const { data: saldoData, error: saldoError } = await supabase
            .from('saldos')
            .select('saldo_usd')
            .eq('user_id', googleId) // Filtramos por el Google ID
            .maybeSingle();

        if (saldoError) {
            console.error("Error de Supabase al obtener saldo:", saldoError.message);
            throw new Error(saldoError.message || "Error desconocido en la consulta de saldo."); 
        }
        
        // C. Calcular nuevo saldo y verificar fondos
        const currentBalance = parseFloat(saldoData?.saldo_usd || '0.00');

        if (currentBalance < amount) {
            console.log(`❌ ERROR: Saldo insuficiente. Actual: ${currentBalance}, Monto: ${amount}`);
            return {
                statusCode: 402, // 402 Payment Required
                body: JSON.stringify({ message: "Saldo insuficiente para completar la transacción." })
            };
        }

        const newBalance = currentBalance - amount;
        
        // 🚨🚨🚨 FIX CLAVE 🚨🚨🚨
        // Convertir newBalance a un número flotante con dos decimales para asegurar la compatibilidad con el tipo 'numeric' de Supabase
        const newBalanceFloat = parseFloat(newBalance.toFixed(2));
        console.log(`✅ Nuevo saldo calculado (Float): ${newBalanceFloat}`);


        // D. Actualizar el saldo en Supabase
        const { error: updateError } = await supabase
            .from('saldos')
            // Utilizamos el valor numérico newBalanceFloat para evitar errores de tipo string
            .update({ saldo_usd: newBalanceFloat }) 
            .eq('user_id', googleId);

        if (updateError) {
            console.error("Error de Supabase al actualizar saldo:", updateError.message);
            return {
                statusCode: 500,
                body: JSON.stringify({ message: "Fallo al actualizar el saldo en la base de datos." }) 
            };
        }

        // E. Registrar la transacción (opcional pero muy recomendado)
        const transactionData = {
            user_id: googleId,
            monto: -amount, // Negativo para deducción
            tipo: 'pago_servicio',
            descripcion: `Pago de servicio con Wallet (${email})`,
            // cartDetails ya es un objeto/array JSON en el cuerpo
            metadatos: { email, whatsapp, cartDetails } 
        };

        const { error: transError } = await supabase
            .from('transacciones')
            .insert(transactionData);

        if (transError) {
            console.error("Error al registrar transacción (advertencia):", transError);
            // El pago fue exitoso, el error de registro es secundario.
        }

        // F. Éxito
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: "Deducción exitosa.",
                nuevo_saldo: newBalanceFloat.toFixed(2),
                usuario: userData.nombre
            }),
        };

    } catch (error) {
        console.error(`[NETLIFY FUNCTION] Error FATAL: ${error.message}`);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: `Error interno del servidor: ${error.message}` })
        };
    }
};