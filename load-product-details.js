// load-product-details.js LIMPIO Y CORREGIDO

document.addEventListener('DOMContentLoaded', () => {
    // Estas variables son accesibles por todas las funciones anidadas (closure)
    let selectedPackage = null;
    let currentProductData = null; // Variable para almacenar los datos del producto actual
    const productContainer = document.getElementById('product-container');
    const rechargeForm = document.getElementById('recharge-form');

    // 1. Funciones de ayuda
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
            // Es buena práctica remover el listener antes de adjuntarlo si la función se llama 
            // más de una vez por si el DOM no se limpia completamente.
            option.removeEventListener('click', handlePackageClick); 
            option.addEventListener('click', handlePackageClick);
        });
        
        // 2. Seleccionar el primer paquete por defecto al cargar/renderizar
        if (packageOptions.length > 0) {
            let shouldSelectDefault = true;
            
            // Revisar si el paquete previamente seleccionado existe todavía en el DOM
            if (selectedPackage && document.body.contains(selectedPackage)) {
                // El paquete seleccionado existe, nos aseguramos de que esté resaltado.
                packageOptions.forEach(opt => opt.classList.remove('selected'));
                selectedPackage.classList.add('selected');
                shouldSelectDefault = false;
            } 
            
            // Si no hay paquete seleccionado (o el anterior se perdió/invalidó), seleccionamos el primero
            if (shouldSelectDefault) {
                packageOptions[0].classList.add('selected');
                selectedPackage = packageOptions[0];
            }
        }
    }


    // Función para renderizar el HTML de los paquetes
    function renderProductPackages(data, currency) {
        const packageOptionsGrid = document.getElementById('package-options-grid');
        
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
        
        // ¡¡¡CLAVE!!! Adjuntar eventos después de renderizar
        attachPackageEventListeners();
    }
    
    // Función para actualizar SÓLO los precios de la UI cuando cambia la moneda
    function updatePackagesUI(currency) {
        if (!currentProductData || !currentProductData.paquetes) return;

        const packageOptionsGrid = document.getElementById('package-options-grid');
        if (!packageOptionsGrid) return; 
        
        const currencySymbol = currency === 'VES' ? 'Bs.' : '$';

        // Recorrer los paquetes y actualizar el precio
        const packageElements = packageOptionsGrid.querySelectorAll('.package-option');
        packageElements.forEach(element => {
            // data-price-usd se mapea a element.dataset.priceUsd (camelCase)
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
                
                // INICIO DE COMPROBACIONES DEFENSIVAS
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
                
                // 🎯 LÓGICA: MOSTRAR CAMPO ID O MENSAJE DE WHATSAPP
                const playerIdInputGroup = document.getElementById('player-id-input-group');
                const whatsappMessage = document.getElementById('whatsapp-info-message');
                const stepOneTitle = document.getElementById('step-one-title');

                if (playerIdInputGroup && whatsappMessage && stepOneTitle) {
                    if (data.require_id === true) {
                        // Requiere ID
                        playerIdInputGroup.style.display = 'block'; 
                        whatsappMessage.style.display = 'none';
                        stepOneTitle.textContent = 'Paso 1: Ingresa tu ID';
                    } else {
                        // NO requiere ID, muestra el mensaje de WhatsApp
                        playerIdInputGroup.style.display = 'none';
                        whatsappMessage.style.display = 'block';
                        stepOneTitle.textContent = 'Paso 1: Asistencia Requerida';
                        // Aseguramos que el campo ID esté vacío para no enviar datos innecesarios
                        const playerIdInput = document.getElementById('player-id-input');
                        if(playerIdInput) playerIdInput.value = '';
                    }
                }
                
                const initialCurrency = localStorage.getItem('selectedCurrency') || 'VES';
                
                // Renderizar los paquetes
                renderProductPackages(data, initialCurrency); 

                // Adjuntar Listener al cambio de moneda (script.js debe disparar este evento)
                window.addEventListener('currencyChange', (event) => { // Corregido: 'currencyChanged' a 'currencyChange'
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
    
    // 3. Manejo del envío del formulario (MODIFICADO: AHORA AÑADE AL CARRITO)
    if (rechargeForm) {
        rechargeForm.addEventListener('submit', (e) => {
            e.preventDefault();

            // 1. Validación
            if (!selectedPackage) {
                alert('Por favor, selecciona un paquete de recarga.');
                return;
            }

            const playerIdInput = document.getElementById('player-id-input');
            const playerId = playerIdInput ? playerIdInput.value.trim() : ''; 

            const requiresId = currentProductData && currentProductData.require_id === true;
            if (requiresId && !playerId) {
                alert('Por favor, ingresa tu ID de Jugador. Este campo es obligatorio para este producto.');
                return;
            }
            
            // 2. Obtener datos
            const packageName = selectedPackage.dataset.packageName;
            const basePriceUSD = parseFloat(selectedPackage.dataset.priceUsd);
            const basePriceVES = parseFloat(selectedPackage.dataset.priceVes);
            const selectedCurrency = localStorage.getItem('selectedCurrency') || 'VES';
            
            // Calcular precio final
            const finalPrice = (selectedCurrency === 'VES') ? basePriceVES : basePriceUSD;
            
            // 3. Construir objeto del ítem del carrito
            const cartItem = {
                id: Date.now(), // ID único para el ítem en el carrito
                game: currentProductData ? currentProductData.nombre : 'Juego Desconocido',
                slug: currentProductData ? currentProductData.slug : 'unknown',
                playerId: playerId, 
                packageName: packageName,
                priceUSD: basePriceUSD.toFixed(2), 
                priceVES: basePriceVES.toFixed(2), 
                finalPrice: finalPrice.toFixed(2), 
                currency: selectedCurrency,
                requiresAssistance: currentProductData.require_id !== true 
            };

            // 4. Agregar al carrito y guardar (Requiere funciones getCart/saveCart de script.js)
            if (typeof getCart === 'function' && typeof saveCart === 'function') {
                const cart = getCart(); 
                cart.push(cartItem);
                saveCart(cart); 

                // 5. Retroalimentación y limpieza
                alert(`✅ ¡"${packageName}" agregado al carrito! Tienes ${cart.length} recarga(s) pendiente(s).`);
                
                // Limpiar selección de paquete y ID
                const packageOptions = document.querySelectorAll('.package-option');
                packageOptions.forEach(opt => opt.classList.remove('selected'));
                selectedPackage = null;
                if (playerIdInput && requiresId) {
                    playerIdInput.value = '';
                }
                // Si hay paquetes, volvemos a seleccionar el primero automáticamente después de limpiar
                if (packageOptions.length > 0) {
                     packageOptions[0].classList.add('selected');
                     selectedPackage = packageOptions[0];
                }

            } else {
                 console.error("Error: Las funciones getCart/saveCart no están disponibles. Asegúrate de cargar script.js primero.");
                 alert('Error interno al añadir al carrito. Revisa la consola.');
            }
        });
        
        // Al cargar la página, cambiar el texto del botón a "Añadir al Carrito"
        const rechargeButton = rechargeForm.querySelector('.recharge-button');
        if (rechargeButton) {
            rechargeButton.textContent = "Añadir al Carrito";
        }
    }

    loadProductDetails();
});