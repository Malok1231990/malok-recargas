const { createClient } = require('@supabase/supabase-js');

/**
 * Netlify Function para obtener el saldo actual del usuario desde Supabase.
 * @param {object} event - El objeto de evento de la solicitud HTTP.
 * @param {object} context - El contexto del cliente, incluyendo los datos de Netlify Identity.
 */
exports.handler = async function(event, context) {
    if (event.httpMethod !== "GET") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // 1. Verificar la autenticación (Netlify Identity)
    const { user } = context.clientContext; 
    
    if (!user) {
        return { 
            statusCode: 401, 
            body: JSON.stringify({ message: "No autorizado. Inicia sesión para ver tu saldo." }) 
        };
    }
    
    // El 'sub' es el ID de usuario único (que mapea a user_id / google_id)
    const userId = user.sub; 
    
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY; 

    if (!supabaseUrl || !supabaseAnonKey) {
        console.error("Faltan variables de entorno de Supabase.");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración del servidor. Faltan credenciales de Supabase." })
        };
    }

    // 2. Inicializar Supabase con la llave pública (Anon Key)
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    try {
        // 3. 🚀 CORRECCIÓN CLAVE: Consultar la tabla 'saldos' y el campo 'saldo_usd'
        const { data: saldoData, error } = await supabase
            .from('saldos') // Tabla correcta
            .select('saldo_usd') // Columna correcta
            .eq('user_id', userId) // Columna de filtro correcta
            .maybeSingle(); 

        if (error) {
            console.error("Error de Supabase al obtener saldo:", error);
            throw new Error(error.message || "Error desconocido en la consulta a Supabase."); 
        }

        // 4. Extraer el valor con el nombre de columna correcto (saldo_usd)
        // Si no existe, asume 0.00
        const saldoActual = saldoData?.saldo_usd || '0.00'; 
        
        // 5. Devolver el saldo. Usamos el nombre 'saldo' para mantener la compatibilidad con el frontend.
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
    }
}