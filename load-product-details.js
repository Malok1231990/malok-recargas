// load-product-details.js

document.addEventListener('DOMContentLoaded', () => {
    // Estas variables son accesibles por todas las funciones anidadas (closure).
    let selectedPackage = null;
    let currentProductData = null; 
    // La variable productContainer no es necesaria si solo se usa para mensajes de error.
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
    
    // Función para adjuntar eventos de clic a los paquetes
    function attachPackageEventListeners() {
        const packageOptions = document.querySelectorAll('.package-option');
        
        // 1. Manejo de la selección de paquetes
        packageOptions.forEach(option => {
            option.removeEventListener('click', handlePackageClick); // Evita duplicados
            option.addEventListener('click', handlePackageClick);
        });
    }

    // Actualiza los precios en la UI según la moneda seleccionada
    function updatePackagesUI(currency) {
        if (!currentProductData || !currentProductData.paquetes) return;

        const packageOptionsGrid = document.getElementById('package-options-grid');
        const currencySymbol = currency === 'VES' ? 'Bs.' : '$';
        // En el dataset del HTML, las claves son 'priceVes' y 'priceUsd'
        const priceKey = currency === 'VES' ? 'priceVes' : 'priceUsd'; 

        const packageElements = packageOptionsGrid.querySelectorAll('.package-option');
        packageElements.forEach(element => {
            // Acceder directamente al dataset usando la clave correcta
            const priceValue = element.dataset[priceKey]; 
            
            if (priceValue) {
                 const price = parseFloat(priceValue).toFixed(2);
                 element.querySelector('.package-price').textContent = `${currencySymbol} ${price}`;
            }
        });
    }

    // --- 2. MANEJADOR DEL FORMULARIO ---

    if (rechargeForm) {
        rechargeForm.addEventListener('submit', (event) => {
            event.preventDefault(); // Detiene la recarga de la página
            
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
            const finalPrice = (selectedCurrency === 'VES') ? basePriceVES : basePriceUSD;
            
            // 5. Construir objeto de la transacción para 'payment.html'
            const transactionDetails = {
                game: currentProductData ? currentProductData.nombre : 'Juego Desconocido',
                playerId: playerId,
                packageName: packageName,
                priceUSD: basePriceUSD.toFixed(2), 
                priceVES: basePriceVES.toFixed(2), 
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
            // Usa el contenedor principal para mostrar el error si el slug falta
            const mainContent = document.querySelector('.product-wrapper') || document.querySelector('main');
            if (mainContent) mainContent.innerHTML = '<h2 class="error-message">❌ Producto no especificado.</h2>';
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
                // Asigna la URL del banner desde Supabase o el fallback
                const bannerUrl = data.banner_url || 'images/default_banner.jpg';
                productBanner.src = bannerUrl;
                productBanner.alt = data.nombre;

                // AÑADIDO CLAVE: Manejar si la imagen de Supabase falla
                productBanner.onerror = function() {
                    // Si la imagen de Supabase (bannerUrl) falla, forzamos el fallback local
                    this.onerror = null; // Previene bucles infinitos
                    this.src = 'images/default_banner.jpg';
                    console.warn(`La imagen para ${data.nombre} falló. Usando imagen por defecto.`);
                };
            }


            // Rellenar las opciones de paquete
            const packageOptionsGrid = document.getElementById('package-options-grid');
            if (packageOptionsGrid) {
                packageOptionsGrid.innerHTML = ''; // Limpiar el mensaje de carga
                
                if (data.paquetes && data.paquetes.length > 0) {
                    const selectedCurrency = localStorage.getItem('selectedCurrency') || 'VES';
                    const currencySymbol = selectedCurrency === 'VES' ? 'Bs.' : '$';
                    // La clave en el objeto JSON que viene de Supabase
                    const priceKey = selectedCurrency === 'VES' ? 'precio_ves' : 'precio_usd'; 

                    data.paquetes.forEach(pkg => {
                        // Usamos la clave de Supabase directamente: pkg.precio_ves o pkg.precio_usd
                        const price = parseFloat(pkg[priceKey]).toFixed(2); 
                        const packageHtml = `
                            <div class="package-option" 
                                data-package-name="${pkg.nombre_paquete}"
                                data-price-usd="${pkg.precio_usd}"
                                data-price-ves="${pkg.precio_ves}"
                                data-package-id="${pkg.id || ''}"
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

                // Adjuntar listener de selección de paquetes
                attachPackageEventListeners();
            }


            // Listener para el cambio de moneda
            window.addEventListener('currencyChanged', (e) => {
                updatePackagesUI(e.detail.currency);
            });
            updatePackagesUI(localStorage.getItem('selectedCurrency') || 'VES'); // Ejecución inicial

        } catch (error) {
            console.error('Error al cargar detalles del producto:', error);
            const mainContent = document.querySelector('.product-wrapper') || document.querySelector('main');
            if (mainContent) {
                 mainContent.innerHTML = '<h2 class="error-message">❌ Error al conectar con el servidor.</h2><p style="text-align:center;">Por favor, recarga la página o vuelve más tarde.</p>';
            }
            document.getElementById('page-title').textContent = 'Error de Carga - Malok Recargas';
        }
    }

    loadProductDetails();
});