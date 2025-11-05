const { OAuth2Client } = require('google-auth-library');
const { createClient } = require('@supabase/supabase-js');

// 💡 BUENA PRÁCTICA: Usamos la variable de entorno para el lado del servidor
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID; 

if (!CLIENT_ID) {
    console.error("GOOGLE_CLIENT_ID no está configurado como variable de entorno de Netlify.");
}

const client = new OAuth2Client(CLIENT_ID);

exports.handler = async function(event, context) {
    // 1. Verificar el método (solo POST)
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: JSON.stringify({ message: "Method Not Allowed" }) };
    }

    // 2. Obtener el token del cuerpo de la solicitud
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ message: "Formato de cuerpo inválido." }) };
    }

    const idToken = body.token;
    if (!idToken) {
        return { statusCode: 400, body: JSON.stringify({ message: "Falta el token de credencial de Google." }) };
    }
    
    // 3. Configuración de Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    // Usamos la Service Key ya que estamos en el backend y necesitamos permisos de escritura/actualización
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY; 
    
    if (!supabaseUrl || !supabaseServiceKey) {
        console.error("Faltan variables de entorno de Supabase.");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración del servidor. Faltan credenciales de Supabase." }) 
        };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    try {
        // =========================================================
        // === VERIFICACIÓN CRÍTICA DEL TOKEN EN EL SERVIDOR ===
        // =========================================================
        const ticket = await client.verifyIdToken({
            idToken: idToken,
            audience: CLIENT_ID, // Asegura que el token fue emitido para TU aplicación
        });

        const payload = ticket.getPayload();
        
        // Información básica del usuario de Google
        const googleId = payload.sub; // ID único de Google
        const email = payload.email;
        const name = payload.name;
        const picture = payload.picture;

        console.log(`Token verificado para el usuario: ${email}`);

        // =========================================================
        // === CREAR/ACTUALIZAR USUARIO EN SUPABASE ===
        // =========================================================
        
        // 1. Buscar si el usuario ya existe por su ID de Google
        let { data: existingUser, error: selectError } = await supabase
            .from('usuarios')
            .select('*')
            .eq('google_id', googleId)
            .single();

        if (selectError && selectError.code !== 'PGRST116') { // PGRST116 = no rows found
             console.error("Error al buscar usuario en Supabase:", selectError);
             throw new Error("Error en la base de datos al verificar usuario.");
        }
        
        let dbResponse;
        let sessionToken = `${googleId}-${Date.now()}`; // Token de sesión simple, realzable con JWT si es necesario.

        if (existingUser) {
            // 2. Si el usuario existe, actualizar sus datos y su token de sesión
            const updateData = { 
                email: email, 
                nombre: name, 
                foto_url: picture,
                ultimo_login: new Date().toISOString(),
                session_token: sessionToken,
            };
            dbResponse = await supabase
                .from('usuarios')
                .update(updateData)
                .eq('id', existingUser.id)
                .select()
                .single();

            console.log("Usuario existente actualizado.");
        } else {
            // 3. Si el usuario no existe, crearlo
            const insertData = {
                google_id: googleId,
                email: email,
                nombre: name,
                foto_url: picture,
                fecha_creacion: new Date().toISOString(),
                ultimo_login: new Date().toISOString(),
                session_token: sessionToken,
            };
            dbResponse = await supabase
                .from('usuarios')
                .insert(insertData)
                .select()
                .single();

            console.log("Nuevo usuario creado.");
        }

        if (dbResponse.error) {
            console.error("Error al guardar/actualizar usuario en Supabase:", dbResponse.error);
            throw new Error(dbResponse.error.message || "Error al registrar/actualizar usuario.");
        }
        
        const finalUser = dbResponse.data;

        // 4. Éxito: Devolver el token de sesión y los datos del usuario
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: "Login exitoso",
                sessionToken: finalUser.session_token,
                user: {
                    id: finalUser.id,
                    name: finalUser.nombre,
                    email: finalUser.email,
                    picture: finalUser.foto_url
                }
            }),
        };

    } catch (error) {
        console.error(`[NETLIFY FUNCTION] Error de autenticación: ${error.message}`);
        // Devolver un 401 (Unauthorized) si la verificación de Google falla
        const statusCode = error.message.includes('Token') ? 401 : 500;
        
        return {
            statusCode: statusCode,
            body: JSON.stringify({ message: error.message || "Error desconocido en el servidor al autenticar." }),
        };
    }
};