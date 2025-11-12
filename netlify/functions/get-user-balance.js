const { createClient } = require('@supabase/supabase-js');

/**
 * Netlify Function para obtener el saldo actual del usuario desde Supabase.
 * @param {object} event - El objeto de evento de la solicitud HTTP.
 * @param {object} context - El contexto del cliente, incluyendo los datos de Netlify Identity.
 */
exports.handler = async function(event, context) {
    console.log("--- INICIO DE FUNCIÓN get-user-balance ---");
    console.log("Método HTTP:", event.httpMethod);
    
    if (event.httpMethod !== "GET") {
        console.log("ERROR: Método no permitido (405).");
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // 1. Verificar la autenticación (Netlify Identity)
    // context.clientContext.user DEBE contener datos si el token es válido
    const { user } = context.clientContext; 
    
    // LOG CLAVE DE AUTENTICACIÓN
    if (!user) {
        console.log("❌ ERROR 401: Usuario NO autenticado por Netlify Identity.");
        console.log("El token en el encabezado 'Authorization: Bearer <token>' es inválido, expiró o no fue reconocido por Netlify.");
        return { 
            statusCode: 401, 
            body: JSON.stringify({ message: "No autorizado. Inicia sesión para ver tu saldo." }) 
        };
    }
    
    console.log("✅ Autenticación exitosa. Usuario Netlify Identity encontrado.");
    const userId = user.sub; 
    console.log("User ID (sub):", userId);
    
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY; 

    // LOG DE CONFIGURACIÓN
    if (!supabaseUrl || !supabaseAnonKey) {
        console.error("Faltan variables de entorno de Supabase. URL o Key no definidos.");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración del servidor. Faltan credenciales de Supabase." })
        };
    }
    console.log("Configuración de Supabase cargada.");

    // 2. Inicializar Supabase con la llave pública (Anon Key)
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    try {
        // 3. Consultar la tabla 'saldos'
        console.log(`Buscando saldo en Supabase para user_id: ${userId}`);
        const { data: saldoData, error } = await supabase
            .from('saldos') // Tabla correcta
            .select('saldo_usd') // Columna correcta
            .eq('user_id', userId) // Columna de filtro correcta
            .maybeSingle(); 
        
        // LOG DE CONSULTA DE SUPABASE
        if (error) {
            console.error("❌ Error de Supabase al obtener saldo:", error.message);
            throw new Error(error.message || "Error desconocido en la consulta a Supabase."); 
        }
        
        // LOG DE DATOS ENCONTRADOS
        console.log("Datos brutos de Supabase (saldoData):", saldoData);

        // 4. Extraer el valor con el nombre de columna correcto (saldo_usd)
        // Si no existe, asume 0.00
        const saldoActual = saldoData?.saldo_usd || '0.00'; 
        
        console.log(`✅ Saldo final encontrado: ${saldoActual}`);
        
        // 5. Devolver el saldo.
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ saldo: saldoActual }),
        };

    } catch (error) {
        console.error("Error FATAL en la función get-user-balance:", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: `Error interno del servidor al cargar el saldo: "${error.message}"` }),
        };
    } finally {
        console.log("--- FIN DE FUNCIÓN get-user-balance ---");
    }
}