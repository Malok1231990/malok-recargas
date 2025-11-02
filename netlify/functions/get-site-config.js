// netlify/functions/get-site-config.js (CORREGIDO Y CON LOGS)

const { createClient } = require('@supabase/supabase-js');

// 🟢 MAPEO: Definimos la relación entre la columna de la DB y la variable CSS
const DB_TO_CSS_MAP = {
    'dark_bg': '--bg-color', 
    'card_bg': '--card-bg',
    'primary_blue': '--primary-blue',
    'accent_green': '--accent-green',
    'text_color': '--text-color',
    'secondary_text': '--secondary-text',
    'input_bg': '--input-bg',
    'button_gradient': '--button-gradient',
    'hover_blue': '--hover-blue',
    'selected_item_gradient': '--selected-item-gradient',
    'shadow_dark': '--shadow-dark',
    'border_color': '--border-color',
    'shadow_light': '--shadow-light',
    'button_text_color': '--button-text-color',
    // Asegúrate de que esta lista sea idéntica a las columnas de tu tabla
};

exports.handler = async function(event, context) {
    if (event.httpMethod !== "GET") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }
    
    // --- 1. Setup ---
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY; 
    
    if (!supabaseUrl || !supabaseAnonKey) {
        console.error("[NETLIFY] ERROR: Faltan variables de entorno de Supabase.");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración del servidor." }) 
        };
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    try {
        // --- 2. Consulta a Supabase ---
        // 🟢 CORRECCIÓN: Usamos 'select(*)' para traer todas las columnas sin aliasing problemático.
        const { data: config, error } = await supabase
            .from('configuracion_sitio') 
            .select('*') 
            .eq('id', 1) 
            .single(); 
        
        console.log("[NETLIFY] LOG: Datos crudos (DB names) recuperados:", config);
            
        // --- 3. Manejo de Errores y Fallback ---
        if (error || !config) {
            const errorMessage = error ? error.message : 'No data found (config is null)';
            console.warn(`[NETLIFY] Advertencia: Error o configuración no encontrada. Usando valores por defecto. Error: ${errorMessage}`);

            // Devolvemos un objeto vacío para que el frontend use el CSS por defecto
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            };
        }

        // --- 4. Mapeo de Claves (De DB a CSS) ---
        const cssConfig = {};
        for (const [dbKey, value] of Object.entries(config)) {
            // Buscamos la variable CSS correspondiente al nombre de la columna DB
            const cssKey = DB_TO_CSS_MAP[dbKey];
            
            // Si la clave existe en nuestro mapa y tiene un valor (no es null), la añadimos.
            if (cssKey && value) {
                cssConfig[cssKey] = value;
            }
        }
        
        console.log("[NETLIFY] LOG: Datos finales (CSS names) enviados:", cssConfig);

        // --- 5. Éxito ---
        // Se devuelve el objeto con las claves CSS (ej: {"--bg-color": "#XXXXXX"})
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cssConfig),
        };

    } catch (error) {
        console.error("[NETLIFY] Error FATAL en la función get-site-config (Catch Block):", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error interno del servidor al obtener la configuración.", details: error.message }),
        };
    }
};