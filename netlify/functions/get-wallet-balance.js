const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
    if (event.httpMethod !== "GET") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // 1. Verificar la autenticación (Asume Netlify Identity)
    // El objeto 'user' viene inyectado si el usuario está logueado.
    const { user } = context.clientContext; 
    
    if (!user) {
        return { 
            statusCode: 401, 
            body: JSON.stringify({ message: "No autorizado. Inicia sesión para ver tu saldo." }) 
        };
    }
    
    // El 'sub' es el ID de usuario de Supabase/Identity
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
    // Esto funciona si tienes Row Level Security (RLS) configurado para que 
    // los usuarios 'authenticated' puedan leer su propia fila en 'perfiles'.
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    try {
        // 3. Consultar solo el saldo del perfil
        const { data: perfil, error } = await supabase
            .from('perfiles')
            .select('saldo')
            .eq('id', userId) // Buscar por el ID del usuario
            .maybeSingle(); 

        if (error) {
            console.error("Error de Supabase al obtener saldo:", error);
            throw new Error(error.message || "Error desconocido en la consulta a Supabase."); 
        }

        const saldoActual = perfil?.saldo || 0.00;

        // 4. Devolver el saldo en el cuerpo de la respuesta
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ saldo: saldoActual }),
        };

    } catch (error) {
        console.error("Error FATAL en la función get-wallet-balance:", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: `Error interno del servidor al cargar el saldo: "${error.message}"` }),
        };
    }
}