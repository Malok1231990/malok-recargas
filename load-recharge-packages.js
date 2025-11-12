// load-recharge-packages.js (FINAL: Con persistencia garantizada en sessionStorage)

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
    // Buscamos ambos IDs de grid por si el nombre cambia entre archivos
    const packageGrid = document.getElementById('package-options-grid') || document.getElementById('recharge-package-options-grid');
    // Usamos el ID del formulario del HTML (product.html)
    const rechargeForm = document.getElementById('recharge-form'); 
    const playerIdInput = document.getElementById('player-id-input'); 
    // Buscamos el botón de submit dentro del formulario
    const selectButton = rechargeForm ? rechargeForm.querySelector('button[type="submit"]') : null; 
    
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
    // === PERSISTENCIA DE ESTADO CON sessionStorage ===
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
            // Aseguramos que guarde el valor actual del input
            playerId: playerIdInput ? playerIdInput.value : '',
            selectedPackageData: selectedPackageData
        };
        sessionStorage.setItem('rechargeFormState', JSON.stringify(currentState));
    }
    
    // 1. Cargar el estado al inicio
    loadFormState();
    
    // 2. Escuchar cambios en el input del ID para guardar el estado en tiempo real
    if (playerIdInput) {
        playerIdInput.addEventListener('input', saveFormState);
    }
    
    // =========================================================================
    // === FUNCIONES EXISTENTES (MODIFICADAS) ===
    // =========================================================================

    function getExchangeRate() {
        const rootStyle = getComputedStyle(document.documentElement);
        let rate = rootStyle.getPropertyValue('--tasa-dolar')?.trim().replace(/['"]/g, ''); 
        return parseFloat(rate) || 38.00; 
    }

    function renderPackages() {
        if (!packageGrid) return;
        
        packageGrid.innerHTML = ''; 
        
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

        // Aplicar la clase 'selected' si hay un paquete en selectedPackageData
        if (selectedPackageData && selectButton) {
            const currentSelected = Array.from(packageGrid.children).find(
                opt => opt.dataset.packageName === selectedPackageData.name
            );
            if (currentSelected) {
                currentSelected.classList.add('selected');
                selectButton.disabled = false;
                selectButton.textContent = `Añadir Recarga de ${selectedPackageData.name.replace('Saldo ', '')} al Carrito`;
            }
        } else if (selectButton) {
             selectButton.disabled = true;
             selectButton.textContent = 'Añadir al Carrito';
        }
    }

    function attachPackageEventListeners() {
        const packageOptions = document.querySelectorAll('.package-option');
        
        packageOptions.forEach(opt => {
            opt.addEventListener('click', function() {
                packageOptions.forEach(o => o.classList.remove('selected'));
                this.classList.add('selected');
                
                selectedPackageData = {
                    name: this.dataset.packageName,
                    usd: this.dataset.priceUsd,
                    ves: this.dataset.priceVes 
                };
                
                if (selectButton) {
                    selectButton.disabled = false;
                    selectButton.textContent = `Añadir Recarga de ${selectedPackageData.name.replace('Saldo ', '')} al Carrito`;
                }

                // Guardar el estado después de seleccionar un paquete
                saveFormState();
            });
        });
    }

    // Escuchar el evento global de cambio de moneda y carga de configuración
    window.addEventListener('currencyChanged', renderPackages); 
    document.addEventListener('siteConfigLoaded', renderPackages, { once: true });
    
    // Lógica de Pago Directo al enviar el formulario
    if (rechargeForm) {
        rechargeForm.addEventListener('submit', (e) => { 
            e.preventDefault();

            if (!selectedPackageData) {
                alert('Por favor, selecciona un paquete de saldo.');
                return;
            }
            
            // 🚩 ¡SOLUCIÓN! 🚩
            // 1. Aseguramos que el estado del formulario (incluyendo el ID final) se guarde en sessionStorage.
            saveFormState(); 
            
            // 2. Leemos el valor final del ID (que está garantizado que está en sessionStorage si la página recarga)
            const currentPlayerId = playerIdInput ? playerIdInput.value : 'N/A';

            // 🟢 PASO 1: Obtener el ID del usuario desde localStorage
            const googleId = getUserId();
            
            if (!googleId) {
                alert('Error: No se encontró la sesión o el ID de usuario. Por favor, inicia sesión para recargar.');
                return;
            }

            // 🟢 PASO 2: Crear el objeto de transacción 
            const transactionItem = {
                id: 'WALLET_RECHARGE_' + Date.now(), 
                game: 'Recarga de Saldo',
                playerId: currentPlayerId, // Usamos el ID del jugador del formulario
                packageName: selectedPackageData.name,
                priceUSD: selectedPackageData.usd, 
                priceVES: selectedPackageData.ves, 
                requiresAssistance: false,
                google_id: googleId 
            };

            // 🟢 PASO 3: Guardar el array de transacción en localStorage
            localStorage.setItem('transactionDetails', JSON.stringify([transactionItem]));

            // 🟢 PASO 4: Redirigir. Si el usuario regresa con el botón "Atrás", loadFormState() restaurará el ID y el paquete.
            window.location.href = 'payment.html';
        });
    }
});