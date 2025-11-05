// load-recharge-packages.js

document.addEventListener('DOMContentLoaded', () => {
    const packageGrid = document.getElementById('recharge-package-options-grid');
    const rechargeForm = document.getElementById('recharge-wallet-form');
    const selectButton = document.getElementById('select-package-btn');
    let selectedPackageData = null;

    // Paquetes de saldo (Hardcodeados para el ejemplo, idealmente desde Supabase)
    const RECHARGE_PACKAGES = [
        { name: 'Saldo $10 USD', usd: '10.00', ves: '380.00' }, 
        { name: 'Saldo $25 USD', usd: '25.00', ves: '950.00' },
        { name: 'Saldo $50 USD', usd: '50.00', ves: '1900.00' },
        { name: 'Saldo $100 USD', usd: '100.00', ves: '3800.00' }
    ];

    function renderPackages() {
        if (!packageGrid) return;
        
        packageGrid.innerHTML = ''; // Limpiar mensaje de carga
        
        RECHARGE_PACKAGES.forEach((pkg, index) => {
            const currentCurrency = window.getCurrentCurrency(); // Asume que esta función existe en script.js
            const price = currentCurrency === 'USD' ? `$${pkg.usd}` : `Bs. ${pkg.ves}`;
            
            const packageHtml = `
                <div class="package-option" 
                     data-package-name="${pkg.name}" 
                     data-price-usd="${pkg.usd}" 
                     data-price-ves="${pkg.ves}" 
                     data-index="${index}">
                    <strong>${pkg.name}</strong>
                    <span>${price}</span>
                </div>
            `;
            packageGrid.insertAdjacentHTML('beforeend', packageHtml);
        });

        attachEventListeners();
    }

    function attachEventListeners() {
        const packageOptions = document.querySelectorAll('.package-option');
        
        packageOptions.forEach(opt => {
            opt.addEventListener('click', function() {
                // 1. Deseleccionar todos
                packageOptions.forEach(p => p.classList.remove('selected'));
                
                // 2. Seleccionar el actual
                this.classList.add('selected');

                // 3. Almacenar los datos y habilitar el botón
                const index = parseInt(this.dataset.index);
                selectedPackageData = RECHARGE_PACKAGES[index];
                
                selectButton.disabled = false;
                selectButton.textContent = `Pagar Recarga de ${selectedPackageData.name}`;
            });
        });

        // Volver a renderizar cuando cambie la moneda (función de script.js)
        window.addEventListener('currencyChanged', renderPackages); 
    }

    // 🎯 Lógica de Pago Directo al enviar el formulario
    rechargeForm.addEventListener('submit', (e) => {
        e.preventDefault();

        if (!selectedPackageData) {
            alert('Por favor, selecciona un paquete de saldo.');
            return;
        }

        // 1. Crear el objeto de transacción (similar a un item de carrito)
        const transactionItem = {
            id: 'WALLET_RECHARGE_' + Date.now(), 
            game: 'Recarga de Saldo', // Identificador especial
            playerId: 'N/A', // No se requiere ID en este flujo
            packageName: selectedPackageData.name,
            priceUSD: selectedPackageData.usd, 
            priceVES: selectedPackageData.ves, 
            requiresAssistance: false // Es un producto directo
        };

        // 2. 🚨 CLAVE: Guardar la transacción directamente, **saltando el carrito**.
        //    payment.html espera un array en 'transactionDetails', por eso envolvemos el objeto.
        localStorage.setItem('transactionDetails', JSON.stringify([transactionItem]));

        // 3. Redirigir inmediatamente a payment.html
        window.location.href = 'payment.html';
    });

    renderPackages(); // Iniciar la carga de paquetes
});