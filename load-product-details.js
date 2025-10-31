// load-product-details.js

document.addEventListener('DOMContentLoaded', () => {
    // Estas variables son accesibles por todas las funciones anidadas (closure).
    // Su declaración aquí asegura que puedan ser usadas por 'handlePackageClick' y 'rechargeForm.addEventListener'.
    let selectedPackage = null;
    let currentProductData = null; 
    const productContainer = document.getElementById('product-container'); // Contenedor de la info del producto
    const rechargeForm = document.getElementById('recharge-form'); // El formulario de recarga

    // --- 1. FUNCIONES DE AYUDA ---

    // Obtener el valor del parámetro 'slug' de la URL
    function getSlugFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('slug');
    }

    // Función que se encarga del evento de clic en un paquete
    function handlePackageClick() {
        const packageOptions = document.querySelectorAll('.package-option');
        
        // 1. Deseleccionar todos
        packageOptions.forEach(opt => opt.classList.remove('selected'));
        
        // 2. Seleccionar el actual (usando 'this' que es el elemento clickeado)
        this.classList.add('selected');
        selectedPackage = this; // Actualiza la variable global
        
        console.log('Paquete seleccionado:', selectedPackage.dataset.packageName);
    }
    
    // Función para adjuntar eventos de clic a los paquetes y manejar la selección inicial
    function attachPackageEventListeners() {
        const packageOptions = document.querySelectorAll('.package-option');
        
        // 1. Manejo de la selección de paquetes
        packageOptions.forEach(option => {
            option.removeEventListener('click', handlePackageClick); // Evita duplicados
            option.addEventListener('click', handlePackageClick);
        });

        // 2. Selección inicial (opcional: si quieres que el primero se seleccione por defecto)
        // if (packageOptions.length > 0 && !selectedPackage) {
        //     handlePackageClick.call(packageOptions[0]);
        // }
    }

    // Actualiza los precios en la UI según la moneda seleccionada
    function updatePackagesUI(currency) {
        if (!currentProductData || !currentProductData.paquetes) return;

        const packageOptionsGrid = document.getElementById('package-options-grid');
        const currencySymbol = currency === 'VES' ? 'Bs.' : '$';
        // Convertir 'precio_ves' a 'priceVes' para usar con dataset.
        const priceKey = currency === 'VES' ? 'priceVes' : 'priceUsd'; 

        const packageElements = packageOptionsGrid.querySelectorAll('.package-option');
        packageElements.forEach(element => {
            // Acceder directamente al dataset usando la key corregida (Ej: dataset.priceVes)
            const priceValue = element.dataset[priceKey]; 
            
            if (priceValue) {
                 const price = parseFloat(priceValue).toFixed(2);
                 element.querySelector('.package-price').textContent = `${currencySymbol} ${price}`;
            }
        });
    }

    // --- 2. MANEJADOR DEL FORMULARIO (LA SOLUCIÓN PRINCIPAL) ---

    if (rechargeForm) {
        rechargeForm.addEventListener('submit', (event) => {
            event.preventDefault(); // 🛑 CLAVE: Detiene la recarga de la página y permite que JS maneje el envío.
            
            // 1. Validar Paquete Seleccionado
            if (!selectedPackage) {
                alert('Paso 2: Por favor, selecciona un paquete de recarga para continuar.');
                return;
            }

            // 2. Validar ID de Jugador
            const playerIdInput = document.getElementById('player-id-input');
            const playerId = playerIdInput ? playerIdInput.value.trim() : '';

            if (!playerId) {
                alert('Paso 1: Por favor, ingresa tu ID de Jugador.');
                playerIdInput.focus(); 
                return;
            }
            
            // 3. Obtener datos del paquete seleccionado
            const packageName = selectedPackage.dataset.packageName;
            const basePriceUSD = parseFloat(selectedPackage.dataset.priceUsd);
            const basePriceVES = parseFloat(selectedPackage.dataset.priceVes);
            
            // 4. Obtener moneda y calcular precio final
            const selectedCurrency = localStorage.getItem('selectedCurrency') || 'VES';
            // Calcular precio final
            const finalPrice = (selectedCurrency === 'VES') ? basePriceVES : basePriceUSD;
            
            // 5. Construir objeto de la transacción para 'payment.html'
            const transactionDetails = {
                game: currentProductData ? currentProductData.nombre : 'Juego Desconocido',
                playerId: playerId,
                packageName: packageName,
                priceUSD: basePriceUSD.toFixed(2), 
                priceVES: basePriceVES.toFixed(2), // Añadido para referencia
                finalPrice: finalPrice.toFixed(2), 
                currency: selectedCurrency 
            };

            // 6. Guardar la transacción en localStorage
            localStorage.setItem('transactionDetails', JSON.stringify(transactionDetails));
            
            // 7. Redirigir a payment.html
            window.location.href = 'payment.html';
        });
    }


    // --- 3. FUNCIÓN PRINCIPAL DE CARGA DE DETALLES ---

    async function loadProductDetails() {
        const slug = getSlugFromUrl();
        if (!slug) {
            if (productContainer) productContainer.innerHTML = '<h2 class="error-message">❌ Producto no especificado.</h2>';
            return;
        }

        try {
            // Llamada a la Netlify Function para obtener el producto
            const response = await fetch(`/.netlify/functions/get-product-details?slug=${slug}`);
            
            if (!response.ok) {
                throw new Error(`Error ${response.status}: No se pudo cargar el producto.`);
            }

            const data = await response.json();
            currentProductData = data; // Guardamos los datos en la variable global

            // Rellenar la información estática del producto
            document.getElementById('page-title').textContent = `${data.nombre} - Malok Recargas`;
            document.getElementById('product-name').textContent = data.nombre;
            document.getElementById('product-description').textContent = data.descripcion || 'Recarga fácil y rápido.';
            
            const productBanner = document.getElementById('product-banner');
            if (productBanner) {
                productBanner.src = data.banner_url || 'images/default_banner.jpg';
                productBanner.alt = data.nombre;
            }


            // Rellenar las opciones de paquete
            const packageOptionsGrid = document.getElementById('package-options-grid');
            if (packageOptionsGrid) {
                packageOptionsGrid.innerHTML = ''; // Limpiar el mensaje de carga
                
                if (data.paquetes && data.paquetes.length > 0) {
                    const selectedCurrency = localStorage.getItem('selectedCurrency') || 'VES';
                    const currencySymbol = selectedCurrency === 'VES' ? 'Bs.' : '$';
                    const priceKey = selectedCurrency === 'VES' ? 'precio_ves' : 'precio_usd'; 

                    data.paquetes.forEach(pkg => {
                        // Usamos la notación de corchetes para acceder al precio dinámicamente
                        const price = parseFloat(pkg[priceKey.replace('_', '')]).toFixed(2); 
                        const packageHtml = `
                            <div class="package-option" 
                                data-package-name="${pkg.nombre_paquete}"
                                data-price-usd="${pkg.precio_usd}"
                                data-price-ves="${pkg.precio_ves}"
                                data-package-id="${pkg.id}"
                            >
                                <span class="package-name">${pkg.nombre_paquete}</span>
                                <span class="package-price">${currencySymbol} ${price}</span>
                            </div>
                        `;
                        packageOptionsGrid.insertAdjacentHTML('beforeend', packageHtml);
                    });
                } else {
                     packageOptionsGrid.innerHTML = '<p class="empty-message">No hay paquetes disponibles para este producto.</p>';
                }

                // Paso Clave: Adjuntar listener de selección de paquetes
                attachPackageEventListeners();
            }


            // Listener para el cambio de moneda (desde script.js)
            window.addEventListener('currencyChanged', (e) => {
                updatePackagesUI(e.detail.currency);
            });
            updatePackagesUI(localStorage.getItem('selectedCurrency') || 'VES'); // Ejecución inicial

        } catch (error) {
            console.error('Error al cargar detalles del producto:', error);
            if (productContainer) productContainer.innerHTML = '<h2 class="error-message">❌ Error al conectar con el servidor.</h2><p style="text-align:center;">Por favor, recarga la página o vuelve más tarde.</p>';
            document.getElementById('page-title').textContent = 'Error de Carga - Malok Recargas';
        }
    }

    loadProductDetails();
});