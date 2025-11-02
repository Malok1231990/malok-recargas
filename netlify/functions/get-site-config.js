// netlify/functions/get-site-config.js (CORRECCIÓN FINAL + LOGS DETALLADOS)

const { createClient } = require('@supabase/supabase-js');

// 🟢 MAPEO: Definimos la relación entre la columna de la DB y la variable CSS
// netlify/functions/get-site-config.js

// 🟢 MAPEO ACTUALIZADO: La clave de la DB ahora se mapea a la variable CSS con el mismo nombre.
const DB_TO_CSS_MAP = {
    // Columna de la DB (clave)  : Nombre de la variable CSS (valor)
    'primary_blue'          : '--primary_blue', 
    'dark_bg'               : '--dark_bg',      
    'card_bg'               : '--card_bg',
    'text_color'            : '--text_color',
    'secondary_text'        : '--secondary_text',
    'accent_green'          : '--accent_green',
    'border_color'          : '--border_color',
    'hover_blue'            : '--hover_blue',
    'shadow_dark'           : '--shadow_dark',
    'shadow_light'          : '--shadow_light',
    'input_bg'              : '--input_bg',
    'selected_item_gradient': '--selected_item_gradient',
    'button_gradient'       : '--button_gradient',
    'button_hover_gradient' : '--button_hover_gradient', // Nuevo
    'button_text_color'     : '--button_text_color', 
    // Asegúrate de que esta lista sea idéntica a las columnas de tu tabla
};

exports.handler = async function(event, context) {
    if (event.httpMethod !== "GET") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }
    
    // --- 1. Setup ---
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY; 
    
    // ... (omito el chequeo de credenciales por brevedad, asumiendo que ya funciona) ...

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    try {
        // --- 2. Consulta a Supabase ---
        // 🟢 CORRECCIÓN CLAVE: Quitamos .single() y usamos .limit(1)
        const { data: rows, error } = await supabase
            .from('configuracion_sitio') 
            .select('*') 
            .eq('id', 1) 
            .limit(1); // Traeremos 0 o 1 fila
        
        if (error) {
            console.error(`[NETLIFY] ERROR EN DB: ${error.message}`);
            throw new Error(error.message); 
        }
        
        // 🟢 COMPROBACIÓN CLAVE: Extraemos la fila de la matriz si existe.
        const config = (rows && rows.length > 0) ? rows[0] : null;
        
        console.log("[NETLIFY] LOG: Array de filas retornado por Supabase:", JSON.stringify(rows));
        console.log("[NETLIFY] LOG: Fila de configuración extraída (config):", JSON.stringify(config));
            
        // --- 3. Manejo de la No Existencia (0 Filas) ---
        if (!config) {
            // El log anterior mostró que config era 'null' porque rows.length era 0.
            console.warn(`[NETLIFY] Advertencia: No se encontró la fila con ID=1. Devolviendo configuración vacía.`);

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}), // Devuelve objeto vacío
            };
        }

        // --- 4. Mapeo de Claves (De DB a CSaS) ---
        const cssConfig = {};
        for (const [dbKey, value] of Object.entries(config)) {
            const cssKey = DB_TO_CSS_MAP[dbKey];
            
            if (cssKey && value) {
                cssConfig[cssKey] = value;
            }
        }
        
        console.log("[NETLIFY] LOG: Datos finales (CSS names) enviados:", JSON.stringify(cssConfig));

        // --- 5. Éxito ---
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cssConfig),
        };

    } catch (error) {
        console.error("[NETLIFY] Error FATAL en la función get-site-config (Catch Block):", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error interno del servidor.", details: error.message }),
        };
    }
};