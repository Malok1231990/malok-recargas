// netlify/functions/get-site-config.js (CORREGIDO)

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

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    try {
        // 🟢 CORRECCIÓN: Usar AS para mapear las columnas de la DB a las variables CSS (Kebab-Case)
        const { data: config, error } = await supabase
            .from('configuracion_sitio') 
            .select(`
                dark_bg:--bg-color,
                card_bg:--card-bg,
                primary_blue:--primary-blue,
                accent_green:--accent-green,
                text_color:--text-color,
                secondary_text:--secondary-text,
                input_bg:--input-bg,
                button_gradient:--button-gradient,
                hover_blue:--hover-blue,
                selected_item_gradient:--selected-item-gradient,
                shadow_dark:--shadow-dark,
                border_color:--border-color,
                shadow_light:--shadow-light,
                button_text_color:--button-text-color 
            `) 
            .eq('id', 1) 
            .single(); 
            
        // Si hay error en la DB o no se encuentra la configuración
        if (error || !config) {
            console.warn(`[NETLIFY] Advertencia: Error o configuración no encontrada. Usando valores por defecto. Error: ${error ? error.message : 'No data'}`);
            // Devolver un objeto vacío para que el cliente use el CSS por defecto, o definir fallbacks
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}), // Devolvemos vacío
            };
        }

        // 🏆 ÉXITO: El objeto 'config' ahora tiene las claves CSS (ej: {"--bg-color": "#XXXXXX"})
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(config),
        };

    } catch (error) {
        console.error("Error FATAL en la función get-site-config:", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error interno del servidor al obtener la configuración.", details: error.message }),
        };
    }
};