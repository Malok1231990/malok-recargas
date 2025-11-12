// load-recharge-packages.js (FINAL: Lectura de ID desde localStorage)

// =========================================================================
// === UTILITY: Obtener Google ID desde localStorage ===
// =========================================================================

/**
 * Utilidad para obtener el google_id del usuario desde localStorage.
 * Asume que el objeto 'userData' guardado en localStorage contiene la propiedad 'google_id'.
 * @returns {string|null} El google_id si existe, o null.
 */
function getUserId() {
    const userDataJson = localStorage.getItem('userData');
    if (userDataJson) {
        try {
            const userData = JSON.parse(userDataJson);
            // 🎯 CLAVE: Acceder a la propiedad google_id
            return userData.google_id || null; 
        } catch (e) {
            console.error("Error al parsear userData de localStorage:", e);
            return null;
        }
    }
    return null;
}

// =========================================================================
// === LÓGICA PRINCIPAL DE PAQUETES ===
// =========================================================================

document.addEventListener('DOMContentLoaded', () => {
    const packageGrid = document.getElementById('recharge-package-options-grid');
    const rechargeForm = document.getElementById('recharge-wallet-form');
    // 🎯 NUEVO: Identificar el input de ID para guardar su estado.
    const playerIdInput = document.getElementById('player-id-input'); 
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
    
    // =========================================================================
    // === PERSISTENCIA DE ESTADO CON sessionStorage (NUEVO) ===
    // =========================================================================

    /**
     * Carga el último estado del formulario (ID de Jugador y Paquete) de sessionStorage.
     */
    function loadFormState() {
        const storedStateJson = sessionStorage.getItem('rechargeFormState');
        if (storedStateJson) {
            try {
                const storedState = JSON.parse(storedStateJson);
                // Restaurar ID del jugador
                if (playerIdInput && storedState.playerId) {
                    playerIdInput.value = storedState.playerId;
                }
                // Restaurar paquete seleccionado
                if (storedState.selectedPackageData) {
                    selectedPackageData = storedState.selectedPackageData;
                }
                
            } catch (e) {
                console.error("Error al parsear el estado del formulario de sessionStorage:", e);
            }
        }
    }
    
    /**
     * Guarda el estado actual del formulario (ID de Jugador y Paquete) en sessionStorage.
     */
    function saveFormState() {
        const currentState = {
            playerId: playerIdInput ? playerIdInput.value : '',
            selectedPackageData: selectedPackageData
        };
        sessionStorage.setItem('rechargeFormState', JSON.stringify(currentState));
    }
    
    // 1. Cargar el estado al inicio
    loadFormState();
    
    // 2. Escuchar cambios en el input del ID para guardar el estado
    if (playerIdInput) {
        playerIdInput.addEventListener('input', saveFormState);
    }
    
    // =========================================================================
    // === FUNCIONES EXISTENTES (MODIFICADAS) ===
    // =========================================================================

    /**
     * 🎯 OBTENER TASA: Obtiene la tasa de cambio del Dólar guardada en la configuración CSS.
     * @returns {number} La tasa de VES/USD. Por defecto 38.00.
     */
    function getExchangeRate() {
        const rootStyle = getComputedStyle(document.documentElement);
        // Lee la variable CSS, elimina comillas si existen, y convierte a float.
        let rate = rootStyle.getPropertyValue('--tasa-dolar')?.trim().replace(/['"]/g, ''); 
        // Usamos 38.00 como fallback si no se puede leer la variable
        return parseFloat(rate) || 38.00; 
    }

    /**
     * Renders the package options based on the current currency.
     */
    function renderPackages() {
        if (!packageGrid) return;
        
        packageGrid.innerHTML = ''; // Limpiar mensaje de carga
        
        const currentCurrency = window.getCurrentCurrency ? window.getCurrentCurrency() : 'USD'; 
        const exchangeRate = getExchangeRate(); 
        
        RECHARGE_PACKAGES.forEach((pkg) => {
            
            const usdPrice = parseFloat(pkg.usd);
            const calculatedVesPrice = (usdPrice * exchangeRate).toFixed(2);
            
            const priceValue = currentCurrency === 'USD' ? usdPrice.toFixed(2) : calculatedVesPrice;
            const priceSymbol = currentCurrency === 'USD' ? '$' : 'Bs.';
            const price = `${priceSymbol} ${priceValue}`;

            const packageHtml = document.createElement('div');
            packageHtml.className = 'package-option';
            packageHtml.dataset.packageName = pkg.name;
            packageHtml.dataset.priceUsd = pkg.usd;
            packageHtml.dataset.priceVes = calculatedVesPrice; 

            packageHtml.innerHTML = `
                <p class="package-name">${pkg.name.replace('Saldo ', '')}</p>
                <p class="package-price">${price}</p>
            `;
            
            packageGrid.appendChild(packageHtml);
        });

        attachPackageEventListeners();

        // 🎯 MODIFICACIÓN: Aplicar la clase 'selected' si hay un paquete en selectedPackageData cargado de sessionStorage
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
                    ves: this.dataset.priceVes 
                };
                
                // 4. Habilitar y actualizar el botón
                selectButton.disabled = false;
                selectButton.textContent = `Pagar Recarga de ${selectedPackageData.name}`;

                // 🎯 NUEVO: Guardar el estado después de seleccionar un paquete
                saveFormState();
            });
        });
    }

    // Escuchar el evento global de cambio de moneda y carga de configuración
    window.addEventListener('currencyChanged', renderPackages); 
    document.addEventListener('siteConfigLoaded', renderPackages, { once: true });
    
    // 🎯 Lógica de Pago Directo al enviar el formulario
    rechargeForm.addEventListener('submit', (e) => { 
        e.preventDefault();

        // 🎯 NUEVO: Leer el valor actual del input del ID justo antes de enviar
        const currentPlayerId = playerIdInput ? playerIdInput.value : 'N/A';

        if (!selectedPackageData) {
            alert('Por favor, selecciona un paquete de saldo.');
            return;
        }
        
        // 🟢 PASO 1: Obtener el ID del usuario desde localStorage
        const googleId = getUserId();
        
        if (!googleId) {
            // Mostrar error si no se encuentra el ID o la sesión (porque no se guardó o no se logueó)
            alert('Error: No se encontró la sesión o el ID de usuario. Por favor, inicia sesión para recargar.');
            return;
        }

        // 🟢 PASO 2: Crear el objeto de transacción 
        const transactionItem = {
            id: 'WALLET_RECHARGE_' + Date.now(), 
            game: 'Recarga de Saldo',
            // 🎯 MODIFICACIÓN: Usar el ID del jugador del formulario (o 'N/A' si no existe el input)
            playerId: currentPlayerId, 
            packageName: selectedPackageData.name,
            priceUSD: selectedPackageData.usd, 
            priceVES: selectedPackageData.ves, 
            requiresAssistance: false,
            // 🎯 CLAVE: Añadir el google_id obtenido de localStorage
            google_id: googleId 
        };

        // 🟢 PASO 3: Guardar el array de transacción en localStorage
        localStorage.setItem('transactionDetails', JSON.stringify([transactionItem]));

        // 🟢 PASO 4: Redirigir inmediatamente a payment.html para procesar el pago.
        // Opcional: Podrías limpiar sessionStorage aquí si NO quieres que persista después de ir al pago.
        // sessionStorage.removeItem('rechargeFormState'); 
        
        window.location.href = 'payment.html';
    });
});