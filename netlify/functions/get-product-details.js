// netlify/functions/get-product-details.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
    if (event.httpMethod !== "GET") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }
    
    const slug = event.queryStringParameters.slug;

    if (!slug) {
        return { 
            statusCode: 400, 
            body: JSON.stringify({ message: "Falta el 'slug' del producto." }) 
        };
    }

    // 1. Configuración de Supabase (usando variables de entorno)
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY; 
    
    // **CHECK CRÍTICO:** Asegura que las credenciales están presentes
    if (!supabaseUrl || !supabaseAnonKey) {
        console.error("Faltan variables de entorno de Supabase.");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración del servidor. Faltan credenciales de Supabase." })
        };
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    try {
        // 2. Consulta a Supabase
        const { data: producto, error } = await supabase
            .from('productos')
            .select(`
                id,
                nombre,
                slug,
                descripcion,
                banner_url,
                // La consulta de paquetes (embedding) es el punto más sensible
                paquetes (
                    nombre_paquete, 
                    precio_usd, 
                    precio_ves, 
                    orden
                )
            `)
            .eq('slug', slug)
            .maybeSingle(); 
            
        // 3. Manejar errores de consulta de Supabase (FIX CLAVE)
        if (error) {
            console.error("Error de Supabase al obtener producto:", error);
            // Capturamos el mensaje de error explícito de Supabase
            throw new Error(error.message || "Error desconocido en la consulta a Supabase."); 
        }

        // 4. Manejar el caso de producto no encontrado
        if (!producto) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: `Producto no encontrado con el slug: ${slug}` })
            };
        }

        // 5. Ordenar los paquetes
        if (producto.paquetes && producto.paquetes.length > 0) {
            producto.paquetes.sort((a, b) => a.orden - b.orden);
        }

        // 6. Devolver los datos
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(producto),
        };

    } catch (error) {
        console.error("Error FATAL en la función get-product-details:", error.message);
        // Devolvemos el error explícito que capturamos arriba o un mensaje genérico.
        return {
            statusCode: 500,
            body: JSON.stringify({ message: `Error interno del servidor al cargar el producto: ${error.message}` }),
        };
    }
}