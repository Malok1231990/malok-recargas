// netlify/functions/get-product-details.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
    // 1. Verificar el método HTTP
    if (event.httpMethod !== "GET") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }
    
    // 2. Obtener el slug del producto desde los query parameters de la URL
    const slug = event.queryStringParameters.slug;

    if (!slug) {
        return { 
            statusCode: 400, 
            body: JSON.stringify({ message: "Falta el 'slug' del producto." }) 
        };
    }

    // 3. Configuración de Supabase (usando variables de entorno)
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY; 
    
    // Asegúrate de que las variables de entorno están configuradas en Netlify
    if (!supabaseUrl || !supabaseAnonKey) {
        console.error("Faltan variables de entorno de Supabase.");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración del servidor. Faltan credenciales de Supabase." })
        };
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    try {
        // 4. Consulta a Supabase
        // Hacemos una única consulta para obtener el producto y sus paquetes relacionados (JOIN implícito)
        const { data: producto, error } = await supabase
            .from('productos')
            .select(`
                id,
                nombre, 
                slug, 
                descripcion,
                banner_url,
                // Aquí obtenemos todos los paquetes relacionados al producto por su 'producto_id'
                paquetes (
                    nombre_paquete, 
                    precio_usd, 
                    precio_ves, 
                    orden
                )
            `)
            .eq('slug', slug)
            .maybeSingle(); // Solo esperar un resultado
            
        if (error) {
            console.error("Error al obtener producto por slug:", error);
            throw new Error(error.message);
        }

        // 5. Manejar el caso de producto no encontrado
        if (!producto) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: `Producto no encontrado con el slug: ${slug}` })
            };
        }

        // 6. Opcional pero recomendado: Ordenar los paquetes por el campo 'orden'
        if (producto.paquetes && producto.paquetes.length > 0) {
            producto.paquetes.sort((a, b) => a.orden - b.orden);
        }

        // 7. Devolver los datos del producto
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(producto),
        };

    } catch (error) {
        console.error("Error en la función get-product-details:", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error interno del servidor al cargar el producto.", details: error.message })
        };
    }
}