// load-recharge-packages.js

document.addEventListener('DOMContentLoaded', () => {
    const packageGrid = document.getElementById('recharge-package-options-grid');
    const rechargeForm = document.getElementById('recharge-wallet-form');
    const selectButton = document.getElementById('select-package-btn');
    let selectedPackageData = null;

    // Paquetes de saldo (Hardcodeados para el ejemplo, idealmente desde Supabase)
    const RECHARGE_PACKAGES = [
        { name: 'Saldo $5 USD', usd: '5.00', ves: '380.00' }, 
        { name: 'Saldo $10 USD', usd: '10.00', ves: '950.00' },
        { name: 'Saldo $20 USD', usd: '20.00', ves: '1900.00' },
        { name: 'Saldo $50 USD', usd: '50.00', ves: '3800.00' },
        { name: 'Saldo $100 USD', usd: '100.00', ves: '3800.00' }
    ];

    /**
     * Renders the package options based on the current currency.
     */
    function renderPackages() {
        if (!packageGrid) return;
        
        packageGrid.innerHTML = ''; // Limpiar mensaje de carga
        
        // La función getCurrentCurrency() se asume que existe en script.js
        // Si no existe, usamos 'USD' por precaución (aunque DEBERÍA existir en script.js).
        const currentCurrency = window.getCurrentCurrency ? window.getCurrentCurrency() : 'USD'; 
        
        RECHARGE_PACKAGES.forEach((pkg, index) => {
            // Usamos Intl.NumberFormat para un formato de moneda correcto
            const priceValue = currentCurrency === 'USD' ? pkg.usd : pkg.ves;
            const priceSymbol = currentCurrency === 'USD' ? '$' : 'Bs.';
            const price = `${priceSymbol} ${priceValue}`;

            const packageHtml = document.createElement('div');
            packageHtml.className = 'package-option';
            // Guardar los datos en el HTML para facilitar la selección
            packageHtml.dataset.packageName = pkg.name;
            packageHtml.dataset.priceUsd = pkg.usd;
            packageHtml.dataset.priceVes = pkg.ves;

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
                
                // 3. Actualizar datos seleccionados
                selectedPackageData = {
                    name: this.dataset.packageName,
                    usd: this.dataset.priceUsd,
                    ves: this.dataset.priceVes
                };
                
                // 4. Habilitar y actualizar el botón
                selectButton.disabled = false;
                selectButton.textContent = `Pagar Recarga de ${selectedPackageData.name}`;
            });
        });
    }

    // 💡 CLAVE: Escuchar el evento global de cambio de moneda (asumiendo que script.js lo emite)
    window.addEventListener('currencyChanged', renderPackages); 
    
    // 🎯 LA LÍNEA CLAVE QUE FALTA EN LA VERSIÓN ORIGINAL, ahora incluida:
    // Al cargar el DOM, renderizamos los paquetes inmediatamente.
    renderPackages(); 
    
    // 🎯 Lógica de Pago Directo al enviar el formulario
    rechargeForm.addEventListener('submit', (e) => {
        e.preventDefault();

        if (!selectedPackageData) {
            alert('Por favor, selecciona un paquete de saldo.');
            return;
        }

        // 1. Crear el objeto de transacción (simulando un único item de carrito)
        const transactionItem = {
            id: 'WALLET_RECHARGE_' + Date.now(), 
            game: 'Recarga de Saldo', // Identificador especial para el backend
            playerId: 'N/A', 
            packageName: selectedPackageData.name,
            priceUSD: selectedPackageData.usd, 
            priceVES: selectedPackageData.ves, 
            requiresAssistance: false // Es un producto directo
        };

        // 2. Guardar la transacción directamente, **saltando el carrito** de compras.
        //    La página payment.html espera un array en 'transactionDetails'.
        localStorage.setItem('transactionDetails', JSON.stringify([transactionItem]));

        // 3. Redirigir inmediatamente a payment.html para procesar el pago.
        window.location.href = 'payment.html';
    });
});