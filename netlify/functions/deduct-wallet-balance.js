const { createClient } = require('@supabase/supabase-js');

/**
 * Netlify Function para deducir el costo de una compra del saldo del usuario en Supabase.
 * Utiliza el token de sesión personalizado para asegurar la autenticación.
 */
exports.handler = async function(event, context) {
    console.log("--- INICIO DE FUNCIÓN deduct-wallet-balance ---");
    
    // 1. Verificar el método HTTP (Debe ser POST para modificar datos)
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
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
    
    // 3. Obtener el cuerpo de la solicitud y validar el monto
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ message: "Cuerpo de solicitud JSON inválido." }) };
    }
    
    // Extraer datos del cuerpo (Se utilizan para el log de transacciones y para la lógica)
    const { amountUSD, email, whatsapp, cartDetails } = body;
    const amountToDeduct = parseFloat(amountUSD);
    
    if (isNaN(amountToDeduct) || amountToDeduct <= 0) {
        return { statusCode: 400, body: JSON.stringify({ message: "Monto a deducir inválido. Debe ser un número positivo." }) };
    }

    // 4. Configuración de Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY; 

    if (!supabaseUrl || !supabaseServiceKey) {
        console.error("Faltan variables de entorno de Supabase (URL o SERVICE_KEY).");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración del servidor." })
        };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    try {
        // 5. Buscar el user_id (Google ID) asociado a este token de sesión personalizado
        const { data: userData, error: userError } = await supabase
            .from('usuarios')
            .select('google_id') 
            .eq('session_token', sessionToken)
            .maybeSingle(); 

        if (userError || !userData) {
            console.error("❌ ERROR 401: Token de sesión inválido o no encontrado en la tabla 'usuarios'.", userError?.message);
            return { statusCode: 401, body: JSON.stringify({ message: "Sesión inválida o expirada. Por favor, vuelve a iniciar sesión." }) };
        }
        
        const userId = userData.google_id;
        console.log(`✅ Token verificado. User ID: ${userId}. Monto a deducir: $${amountToDeduct.toFixed(2)}`);

        // =========================================================
        // === 6. LÓGICA CLAVE DE DEDUCCIÓN DE SALDO ===
        // =========================================================

        // A. Obtener saldo actual
        const { data: saldoData, error: saldoError } = await supabase
            .from('saldos') 
            .select('saldo_usd') 
            .eq('user_id', userId)
            .maybeSingle(); 

        if (saldoError) {
            console.error("Error Supabase al obtener saldo:", saldoError.message);
            throw new Error(saldoError.message || "Error al verificar el saldo."); 
        }

        const saldoActual = parseFloat(saldoData?.saldo_usd || 0); 
        
        // B. Verificar saldo suficiente
        if (saldoActual < amountToDeduct) {
            console.log("❌ ERROR 402: Saldo insuficiente.");
            return {
                statusCode: 402, 
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: "Saldo insuficiente en la Wallet para completar la compra. Por favor, recargue su saldo." }),
            };
        }

        // C. Calcular y Actualizar el saldo
        const nuevoSaldo = saldoActual - amountToDeduct;
        
        // Aseguramos que el saldo no baje de cero (aunque ya se verificó antes) y lo redondeamos a 2 decimales
        const saldoFinalUpdate = nuevoSaldo > 0 ? nuevoSaldo.toFixed(2) : '0.00'; 
        
        const { error: updateError } = await supabase
            .from('saldos')
            .update({ saldo_usd: saldoFinalUpdate })
            .eq('user_id', userId);

        if (updateError) {
            console.error("Error Supabase al actualizar saldo:", updateError.message);
            // Esto puede ser un error fatal, revertir la lógica si fuera posible (Transacciones de base de datos)
            throw new Error(`Error desconocido al actualizar el saldo: ${updateError.message}`); 
        }

        console.log(`✅ Saldo actualizado de $${saldoActual.toFixed(2)} a $${saldoFinalUpdate}.`);

        // D. Devolver éxito (La función 'procces_payment' se llamará después en el frontend)
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                message: "Deducción de saldo exitosa. Procede a notificar el pago.",
                nuevo_saldo: saldoFinalUpdate
            }),
        };

    } catch (error) {
        console.error("Error FATAL en la función deduct-wallet-balance:", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: `Error interno del servidor: "${error.message}"` }),
        };
    } finally {
        console.log("--- FIN DE FUNCIÓN deduct-wallet-balance ---");
    }
}