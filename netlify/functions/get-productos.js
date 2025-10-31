// netlify/functions/get-productos.js

const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
    // 1. Verificar el método (solo GET)
    if (event.httpMethod !== "GET") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // 2. Configuración de Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    // 🟢 CORRECCIÓN: Usamos la clave de servicio (temporalmente) ya que la ANON_KEY no está definida.
    const supabaseAnonKey = process.env.SUPABASE_SERVICE_KEY; 
    
    // Asegúrate de que las variables de entorno están configuradas
    if (!supabaseUrl || !supabaseAnonKey) {
        console.error("Faltan variables de entorno de Supabase.");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración del servidor. Faltan credenciales de Supabase." })
        };
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    try {
        // 3. Obtener los datos con JOIN de productos y paquetes
        const { data: productos, error } = await supabase
            .from('productos')
            .select(`
                *, 
                paquetes (*)
            `)
            .eq('activo', true) // Mantiene el filtro para solo mostrar productos activos
            .order('orden', { ascending: true });
            
        // 4. Manejar errores
        if (error) {
            console.error("Error fetching products:", error);
            return {
                statusCode: 500,
                body: JSON.stringify({ message: "Error al obtener los productos", details: error.message })
            };
        }

        // 5. Devolver la respuesta
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(productos),
        };

    } catch (error) {
        console.error("Error en la función get-productos:", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error interno del servidor", details: error.message }),
        };
    }
}