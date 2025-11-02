// netlify/functions/get-site-config.js

const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
    if (event.httpMethod !== "GET") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY; 
    
    if (!supabaseUrl || !supabaseAnonKey) {
        console.error("Faltan variables de entorno de Supabase.");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración del servidor. Faltan credenciales de Supabase." }) 
        };
    }

    // Usar la clave ANÓNIMA para lecturas públicas (más seguro)
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    try {
        // Obtenemos la configuración del sitio (asumiendo que tiene una única fila con ID 1)
        const { data: config, error } = await supabase
            .from('configuracion_sitio') // Usa el nombre de tu tabla de configuración
            .select('*')
            .eq('id', 1) // Asume que la configuración está en el ID 1
            .single(); 
            
        // Si hay error en la DB o no se encuentra la configuración, devolvemos un objeto vacío para usar CSS por defecto
        if (error || !config) {
            console.warn(`[NETLIFY] Advertencia: Error o configuración no encontrada. Usando valores por defecto. Error: ${error ? error.message : 'No data'}`);
            // Devolver un objeto vacío o valores por defecto
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    '--primary-blue': '#007bff',
                    '--dark-bg': '#1a1a1a',
                    // ... (añade aquí todos los valores por defecto de style.css)
                }),
            };
        }

        // Devolvemos la configuración (que incluye los colores como --nombre-variable)
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(config),
        };

    } catch (error) {
        console.error("Error FATAL en la función get-site-config:", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error interno del servidor al obtener configuración." }),
        };
    }
};