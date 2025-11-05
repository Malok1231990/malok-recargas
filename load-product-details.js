// load-product-details.js

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
                
                // 🎯 NUEVA LÓGICA: MOSTRAR CAMPO ID O MENSAJE DE WHATSAPP
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
    
    // 3. Manejo del envío del formulario (ESTO DEBE ESTAR AQUÍ PARA EJECUTARSE SOLO UNA VEZ)
    if (rechargeForm) {
        rechargeForm.addEventListener('submit', (e) => {
            e.preventDefault();

            if (!selectedPackage) {
                alert('Por favor, selecciona un paquete de recarga.');
                return;
            }

            const playerIdInput = document.getElementById('player-id-input');
            // Si el campo ID no es requerido, playerId será una cadena vacía ('')
            const playerId = playerIdInput ? playerIdInput.value.trim() : ''; 

            // 🎯 LÓGICA DE VALIDACIÓN CONDICIONAL
            if (currentProductData && currentProductData.require_id === true) {
                if (!playerId) {
                    alert('Por favor, ingresa tu ID de Jugador. Este campo es obligatorio para este producto.');
                    return;
                }
            }
            
            // Obtener datos del paquete seleccionado
            const packageName = selectedPackage.dataset.packageName;
            // Usamos los strings del dataset, que ya vienen con 2 decimales
            const itemPriceUSD = selectedPackage.dataset.priceUsd; 
            const itemPriceVES = selectedPackage.dataset.priceVes; 
            
            
            // =============================================================
            // === MODIFICACIÓN CLAVE: AÑADIR AL CARRITO Y HACER CHECKOUT ===
            // =============================================================
            
            // 1. Construir objeto de Ítem de Carrito con ID único
            const cartItem = {
                id: Date.now(), // ID único basado en el timestamp
                game: currentProductData ? currentProductData.nombre : 'Juego Desconocido',
                // Enviamos el ID, que puede ser vacío ('') si no se requiere, o el valor ingresado
                playerId: playerId, 
                packageName: packageName,
                // Enviamos ambos precios como strings (tal como están en el dataset)
                priceUSD: itemPriceUSD, 
                priceVES: itemPriceVES, 
                requiresAssistance: currentProductData.require_id !== true 
            };

            // 2. Llamar a la función global para añadir al carrito (definida en script.js)
            if (window.addToCart) {
                window.addToCart(cartItem);
            } else {
                console.error("Función addToCart no encontrada. ¿Está script.js cargado?");
            }

            // 3. MOSTRAR MENSAJE DE CONFIRMACIÓN (Opcional, pero te permite ver que se agregó)
            alert(`✅ ¡Tu recarga de ${packageName} para ${cartItem.game} se ha agregado al carrito! Redirigiendo al pago...`);
            
            // 4. 🛑 NUEVO ARREGLO: Llama a la función de checkout y redirige.
            // Asume que window.checkout está definido en script.js y maneja:
            //     a) Obtener el carrito de localStorage ('cartItems').
            //     b) Guardar el objeto {total: X, items: [...]} en 'transactionDetails'.
            //     c) Redirigir a 'payment.html'.
            if (window.checkout) {
                window.checkout();
            } else {
                // Si no existe, al menos intentamos la redirección manual
                console.error("Función checkout no encontrada. Redirigiendo manualmente.");
                window.location.href = 'payment.html'; 
            }

            // Opcional: limpiar el campo de ID después de añadir
            if(playerIdInput) playerIdInput.value = '';

            // ELIMINADA LA LLAMADA A window.toggleCart(true);
            // =============================================================
        });
    }

    loadProductDetails();
});