// load-recharge-packages.js (MODIFICADO: Google ID desde Supabase)

// =========================================================================
// === SUPABASE UTILITY: Obtener Google ID ===
// =========================================================================

/**
 * 🎯 NUEVO: Obtiene el google_id del usuario consultando Supabase.
 * Asume que el cliente Supabase está disponible globalmente como 'supabase'.
 * @returns {Promise<string|null>} El google_id si existe, o null en caso de error o no logueado.
 */
async function fetchGoogleId() {
    // 1. Obtener la sesión actual de Supabase Auth
    // Nota: Se asume que la librería de Supabase ya está cargada y disponible.
    if (typeof supabase === 'undefined') {
        console.error("Error: Cliente de Supabase no encontrado. Asegúrate de que está inicializado.");
        return null;
    }
    
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
        // Usuario no logueado
        return null;
    }

    const userId = session.user.id; // ID de autenticación de Supabase

    // 2. Consultar la tabla 'usuarios'
    // Se asume que el ID de Supabase (userId) se usa para identificar al usuario en la tabla 'usuarios'.
    const { data: userData, error: userError } = await supabase
        .from('usuarios')
        .select('google_id')
        .eq('id', userId) 
        .single(); 

    if (userError || !userData) {
        console.error("Error al buscar el google_id en Supabase:", userError);
        return null;
    }

    // 3. Devolver el google_id
    return userData.google_id || null;
}


// =========================================================================
// === LÓGICA PRINCIPAL DE PAQUETES ===
// =========================================================================

document.addEventListener('DOMContentLoaded', () => {
    const packageGrid = document.getElementById('recharge-package-options-grid');
    const rechargeForm = document.getElementById('recharge-wallet-form');
    const selectButton = document.getElementById('select-package-btn');
    let selectedPackageData = null;

    // Paquetes de saldo (Hardcodeados para el ejemplo, idealmente desde Supabase)
    const RECHARGE_PACKAGES = [
        { name: 'Saldo $5 USD', usd: '5.00' },
        { name: 'Saldo $10 USD', usd: '10.00' }, 
        { name: 'Saldo $20 USD', usd: '20.00' },
        { name: 'Saldo $50 USD', usd: '50.00' },
        { name: 'Saldo $100 USD', usd: '100.00' },
        { name: 'Saldo $200 USD', usd: '200.00' }
    ];

    /**
     * 🎯 OBTENER TASA: Obtiene la tasa de cambio del Dólar guardada en la configuración CSS.
     * @returns {number} La tasa de VES/USD. Por defecto 38.00.
     */
    function getExchangeRate() {
        const rootStyle = getComputedStyle(document.documentElement);
        // Lee la variable CSS, elimina comillas si existen, y convierte a float.
        let rate = rootStyle.getPropertyValue('--tasa-dolar')?.trim().replace(/['"]/g, ''); // Uso de optional chaining por seguridad
        // Usamos 38.00 como fallback si no se puede leer la variable
        return parseFloat(rate) || 38.00; 
    }

    /**
     * Renders the package options based on the current currency.
     */
    function renderPackages() {
        if (!packageGrid) return;
        
        packageGrid.innerHTML = ''; // Limpiar mensaje de carga
        
        // La función getCurrentCurrency() se asume que existe en script.js
        const currentCurrency = window.getCurrentCurrency ? window.getCurrentCurrency() : 'USD'; 
        // 🎯 OBTENER: Obtener la tasa de cambio
        const exchangeRate = getExchangeRate(); 
        
        RECHARGE_PACKAGES.forEach((pkg) => {
            
            const usdPrice = parseFloat(pkg.usd);
            
            // 🎯 CÁLCULO CLAVE: Precio en VES se calcula a partir del USD y la Tasa.
            const calculatedVesPrice = (usdPrice * exchangeRate).toFixed(2);
            
            // Usamos el precio en USD o el precio CALCULADO en VES
            const priceValue = currentCurrency === 'USD' ? usdPrice.toFixed(2) : calculatedVesPrice;
            const priceSymbol = currentCurrency === 'USD' ? '$' : 'Bs.';
            const price = `${priceSymbol} ${priceValue}`;

            const packageHtml = document.createElement('div');
            packageHtml.className = 'package-option';
            // Guardar los datos en el HTML
            packageHtml.dataset.packageName = pkg.name;
            packageHtml.dataset.priceUsd = pkg.usd;
            // 🎯 IMPORTANTE: El precio VES guardado AHORA es el calculado, no el hardcodeado.
            packageHtml.dataset.priceVes = calculatedVesPrice; 

            packageHtml.innerHTML = `
                <p class="package-name">${pkg.name.replace('Saldo ', '')}</p>
                <p class="package-price">${price}</p>
            `;
            
            packageGrid.appendChild(packageHtml);
        });

        // Re-adjuntar eventos después de renderizar para que funcionen los clics
        attachPackageEventListeners();

        // Si ya había un paquete seleccionado, re-selecciona el elemento DOM y actualiza el botón
        if (selectedPackageData) {
            const currentSelected = Array.from(packageGrid.children).find(
                opt => opt.dataset.packageName === selectedPackageData.name
            );
            if (currentSelected) {
                currentSelected.classList.add('selected');
                selectButton.disabled = false;
                selectButton.textContent = `Pagar Recarga de ${selectedPackageData.name}`;
            }
        } else {
             // Si no hay selección, el botón debe estar deshabilitado y con el texto por defecto
             selectButton.disabled = true;
             selectButton.textContent = 'Continuar al Pago';
        }
    }

    /**
     * Attaches click listeners to the dynamically created package options.
     */
    function attachPackageEventListeners() {
        const packageOptions = document.querySelectorAll('.package-option');
        
        packageOptions.forEach(opt => {
            opt.addEventListener('click', function() {
                // 1. Deseleccionar todos
                packageOptions.forEach(o => o.classList.remove('selected'));
                
                // 2. Seleccionar el actual
                this.classList.add('selected');
                
                // 3. Actualizar datos seleccionados, incluyendo el precio VES calculado
                selectedPackageData = {
                    name: this.dataset.packageName,
                    usd: this.dataset.priceUsd,
                    ves: this.dataset.priceVes // Ahora toma el valor calculado del DOM
                };
                
                // 4. Habilitar y actualizar el botón
                selectButton.disabled = false;
                selectButton.textContent = `Pagar Recarga de ${selectedPackageData.name}`;
            });
        });
    }

    // 💡 CLAVE 1: Escuchar el evento global de cambio de moneda (para actualizar si el usuario cambia)
    window.addEventListener('currencyChanged', renderPackages); 
    
    // 🎯 CLAVE 2 (SOLUCIÓN): Ejecutar renderPackages SOLO cuando la configuración (incluida la tasa) esté cargada
    // Esto previene el race condition, asumiendo que script.js dispara 'siteConfigLoaded'.
    document.addEventListener('siteConfigLoaded', renderPackages, { once: true });
    
    // 🎯 Lógica de Pago Directo al enviar el formulario
    rechargeForm.addEventListener('submit', async (e) => { // 🚨 HACER LA FUNCIÓN ASÍNCRONA
        e.preventDefault();

        if (!selectedPackageData) {
            alert('Por favor, selecciona un paquete de saldo.');
            return;
        }
        
        // 🟢 PASO 1: Obtener el ID del usuario desde Supabase
        // Deshabilitar el botón para evitar múltiples clics
        selectButton.disabled = true;
        selectButton.textContent = 'Verificando sesión...';

        const googleId = await fetchGoogleId();
        
        if (!googleId) {
            // Revertir el estado del botón
            selectButton.disabled = false;
            selectButton.textContent = `Pagar Recarga de ${selectedPackageData.name}`;
            
            // Mostrar error si no se encuentra el ID o la sesión
            alert('Error: No se encontró la sesión o el ID de usuario. Por favor, inicia sesión para recargar y verifica tu conexión.');
            // Opcional: Redirigir a login.html si no está logueado.
            // window.location.href = 'login.html'; 
            return;
        }

        // 🟢 PASO 2: Crear el objeto de transacción (simulando un único item de carrito)
        const transactionItem = {
            id: 'WALLET_RECHARGE_' + Date.now(), 
            game: 'Recarga de Saldo', // Identificador especial para el backend
            playerId: 'N/A', 
            packageName: selectedPackageData.name,
            priceUSD: selectedPackageData.usd, 
            priceVES: selectedPackageData.ves, 
            requiresAssistance: false,
            // 🎯 CLAVE: Añadir el google_id obtenido de Supabase
            google_id: googleId 
        };

        // 🟢 PASO 3: Guardar el array de transacción en localStorage
        // La página payment.html espera un array en 'transactionDetails'.
        localStorage.setItem('transactionDetails', JSON.stringify([transactionItem]));

        // 🟢 PASO 4: Redirigir inmediatamente a payment.html para procesar el pago.
        window.location.href = 'payment.html';
        
        // Restablecer el botón después de redirigir (aunque la página se recarga, es buena práctica)
        selectButton.disabled = false;
        selectButton.textContent = `Pagar Recarga de ${selectedPackageData.name}`;
    });
});