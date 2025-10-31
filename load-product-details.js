// load-product-details.js

document.addEventListener('DOMContentLoaded', () => {
    let selectedPackage = null;
    let currentProductData = null; // Variable para almacenar los datos del producto actual
    const productContainer = document.getElementById('product-container');
    const rechargeForm = document.getElementById('recharge-form');

    // 1. Funciones de ayuda
    function getSlugFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('slug');
    }

    // Función para renderizar el HTML de los paquetes
    function renderProductPackages(data, currency) {
        const packageOptionsGrid = document.getElementById('package-options-grid');
        
        // Comprobación defensiva del elemento (IMPORTANTE)
        if (!packageOptionsGrid) {
            console.error("El contenedor de paquetes (#package-options-grid) no fue encontrado en el HTML.");
            return;
        }
        
        packageOptionsGrid.innerHTML = ''; // Limpiar el contenido de carga

        if (!data.paquetes || data.paquetes.length === 0) {
            packageOptionsGrid.innerHTML = '<p class="empty-message">Aún no hay paquetes de recarga disponibles para este juego.</p>';
            return;
        }

        const currencySymbol = currency === 'VES' ? 'Bs.' : '$';
        const priceKey = currency === 'VES' ? 'precio_ves' : 'precio_usd';

        data.paquetes.forEach(pkg => {
            // Asegurarse de que las propiedades existen y son números válidos
            const usdPrice = parseFloat(pkg.precio_usd || 0).toFixed(2);
            const vesPrice = parseFloat(pkg.precio_ves || 0).toFixed(2);
            const displayPrice = currency === 'VES' ? vesPrice : usdPrice;

            const packageHtml = `
                <div 
                    class="package-option" 
                    data-package-name="${pkg.nombre_paquete}"
                    data-price-usd="${usdPrice}"
                    data-price-ves="${vesPrice}"
                >
                    <div class="package-name">${pkg.nombre_paquete}</div>
                    <div class="package-price">${currencySymbol} ${displayPrice}</div>
                </div>
            `;
            packageOptionsGrid.insertAdjacentHTML('beforeend', packageHtml);
        });
        
        // Adjuntar eventos después de renderizar
        attachPackageEventListeners();
    }
    
    // Función para actualizar SÓLO los precios de la UI cuando cambia la moneda
    function updatePackagesUI(currency) {
        if (!currentProductData || !currentProductData.paquetes) return;

        const packageOptionsGrid = document.getElementById('package-options-grid');
        if (!packageOptionsGrid) return; // Comprobación defensiva
        
        const currencySymbol = currency === 'VES' ? 'Bs.' : '$';
        const priceKey = currency === 'VES' ? 'precio_ves' : 'precio_usd';

        // Recorrer los paquetes y actualizar el precio
        const packageElements = packageOptionsGrid.querySelectorAll('.package-option');
        packageElements.forEach(element => {
            // Reemplazamos '_' en price_usd/price_ves con mayúsculas 'U'/'V' para que coincida con dataset (dataset.priceUsd)
            const priceKeyDataset = currency === 'VES' ? 'priceVes' : 'priceUsd';
            const price = parseFloat(element.dataset[priceKeyDataset]).toFixed(2);
            element.querySelector('.package-price').textContent = `${currencySymbol} ${price}`;
        });
    }


    // Función principal para cargar los detalles del producto
    async function loadProductDetails() {
        const slug = getSlugFromUrl();
        if (!slug) {
            if (productContainer) {
                 productContainer.innerHTML = '<h2 class="error-message">❌ Error: No se especificó el juego.</h2><p style="text-align:center;"><a href="index.html">Volver a la página principal</a></p>';
            }
            const pageTitle = document.getElementById('page-title');
            if (pageTitle) pageTitle.textContent = 'Error - Malok Recargas';
            return;
        }

        try {
            // Llama a tu Netlify Function para obtener el producto
            const response = await fetch(`/.netlify/functions/get-product-details?slug=${slug}`);
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Error ${response.status}: ${errorData.message}`);
            }

            const data = await response.json();
            
            // 2. Cargar datos en la UI (FIX)
            if (data) {
                currentProductData = data; // Almacenar los datos
                
                // INICIO DE COMPROBACIONES DEFENSIVAS (FIX para "Cannot set properties of null")
                const pageTitle = document.getElementById('page-title');
                if (pageTitle) pageTitle.textContent = `${data.nombre} - Malok Recargas`;

                const productName = document.getElementById('product-name');
                if (productName) productName.textContent = data.nombre;

                const productDescription = document.getElementById('product-description');
                if (productDescription) productDescription.textContent = data.descripcion;

                const bannerImage = document.getElementById('product-banner-image');
                if (bannerImage) {
                    bannerImage.src = data.banner_url || 'images/default_banner.jpg';
                    bannerImage.alt = data.nombre;
                }
                // FIN DE COMPROBACIONES DEFENSIVAS
                
                const initialCurrency = localStorage.getItem('selectedCurrency') || 'VES';
                
                // Renderizar los paquetes
                renderProductPackages(data, initialCurrency); 

                // Adjuntar Listener al cambio de moneda (script.js debe disparar este evento)
                window.addEventListener('currencyChanged', (event) => {
                    updatePackagesUI(event.detail.currency);
                });

            } else {
                if (productContainer) {
                    productContainer.innerHTML = '<h2 class="error-message">❌ Producto no encontrado.</h2><p style="text-align:center;"><a href="index.html">Volver a la página principal</a></p>';
                }
            }

        } catch (error) {
            console.error('Error al cargar detalles del producto:', error);
            if (productContainer) {
                productContainer.innerHTML = '<h2 class="error-message">❌ Error al conectar con el servidor.</h2><p style="text-align:center;">Por favor, recarga la página o vuelve más tarde.</p>';
            }
            const pageTitle = document.getElementById('page-title');
            if (pageTitle) pageTitle.textContent = 'Error de Carga - Malok Recargas';
        }
    }
    
    // Función para manejar la selección de paquetes y el envío del formulario
    function attachPackageEventListeners() {
        const packageOptions = document.querySelectorAll('.package-option');
        
        // 1. Manejo de la selección de paquetes
        packageOptions.forEach(option => {
            option.addEventListener('click', () => {
                // Deseleccionar todos
                packageOptions.forEach(opt => opt.classList.remove('selected'));
                // Seleccionar el actual
                option.classList.add('selected');
                selectedPackage = option;
            });
        });
        
        // 2. Seleccionar el primer paquete por defecto al cargar/renderizar
        if (packageOptions.length > 0) {
            // Si selectedPackage es null o ya no existe en el DOM (recarga), seleccionamos el primero
            if (!selectedPackage || !document.body.contains(selectedPackage)) {
                packageOptions[0].classList.add('selected');
                selectedPackage = packageOptions[0];
            } else if (!selectedPackage.classList.contains('selected')) {
                // Si el paquete previamente seleccionado todavía existe, nos aseguramos de que esté resaltado.
                selectedPackage.classList.add('selected');
            }
        }


        // 3. Manejo del envío del formulario
        if (rechargeForm) {
            rechargeForm.addEventListener('submit', (e) => {
                e.preventDefault();

                if (!selectedPackage) {
                    alert('Por favor, selecciona un paquete de recarga.');
                    return;
                }

                const playerIdInput = document.getElementById('player-id-input');
                const playerId = playerIdInput ? playerIdInput.value.trim() : '';

                if (!playerId) {
                    alert('Por favor, ingresa tu ID de Jugador.');
                    return;
                }
                
                // Obtener datos del paquete seleccionado
                const packageName = selectedPackage.dataset.packageName;
                const basePriceUSD = parseFloat(selectedPackage.dataset.priceUsd);
                const basePriceVES = parseFloat(selectedPackage.dataset.priceVes);
                const selectedCurrency = localStorage.getItem('selectedCurrency') || 'VES';
                
                // Calcular precio final
                const finalPrice = (selectedCurrency === 'VES') ? basePriceVES : basePriceUSD;
                
                // Construir objeto de la transacción para 'payment.html'
                const transactionDetails = {
                    game: currentProductData ? currentProductData.nombre : 'Juego Desconocido',
                    playerId: playerId,
                    packageName: packageName,
                    priceUSD: basePriceUSD.toFixed(2), 
                    priceVES: basePriceVES.toFixed(2), // Añadido para referencia
                    finalPrice: finalPrice.toFixed(2), 
                    currency: selectedCurrency 
                };

                localStorage.setItem('transactionDetails', JSON.stringify(transactionDetails));
                window.location.href = 'payment.html';
            });
        }
    }

    loadProductDetails();
});