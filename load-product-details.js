// load-product-details.js COMPLETO Y MODIFICADO

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
            option.removeEventListener('click', handlePackageClick); // Previene duplicados
            option.addEventListener('click', handlePackageClick);
        });
        
        // 2. Intentar seleccionar el primero por defecto si no hay ninguno
        if (!selectedPackage && packageOptions.length > 0) {
            packageOptions[0].classList.add('selected');
            selectedPackage = packageOptions[0];
        }
    }
    
    // 3. Función principal para cargar los detalles del producto
    async function loadProductDetails() {
        const slug = getSlugFromUrl();
        if (!slug || !productContainer) {
            return; // Salir si no hay slug o no estamos en product.html
        }

        const titleElement = document.getElementById('page-title');
        const mainTitleElement = document.getElementById('product-main-title');
        const imageElement = document.getElementById('product-image');
        const descriptionElement = document.getElementById('product-description');
        const packagesGrid = document.getElementById('package-options-grid');
        const packagesLoading = document.getElementById('packages-loading');
        const playerIdGroup = document.getElementById('player-id-group');
        const whatsappMessageBox = document.getElementById('whatsapp-info-message');

        try {
            // Llamada a la Netlify Function para obtener el producto por slug
            const response = await fetch(`/.netlify/functions/get-producto-by-slug?slug=${slug}`);
            
            if (!response.ok) {
                throw new Error(`Error ${response.status}: No se pudo cargar el producto.`);
            }

            const product = await response.json();
            
            if (!product) {
                productContainer.innerHTML = '<h2>Producto No Encontrado</h2><p>El juego que buscas no está disponible.</p>';
                return;
            }

            currentProductData = product; // Guardar datos para usar en el submit
            
            // Actualizar el DOM
            titleElement.textContent = `${product.nombre} - Malok Recargas`;
            mainTitleElement.textContent = product.nombre;
            imageElement.src = product.banner_url || 'images/default_banner.jpg';
            descriptionElement.textContent = product.descripcion;
            
            // Manejar campos de ID y mensaje de WhatsApp
            const requiresId = product.require_id === true;
            const requiresAssistance = product.require_id !== true; // Si NO es por ID, requiere asistencia

            // Mostrar/Ocultar el campo de ID
            if (playerIdGroup) {
                playerIdGroup.style.display = requiresId ? 'block' : 'none';
                
                // Si el campo de ID está visible, actualiza el placeholder para indicar el tipo de ID
                const playerIdInput = document.getElementById('player-id-input');
                if (requiresId && playerIdInput) {
                    playerIdInput.placeholder = product.id_placeholder || 'Ingresa tu ID de Usuario/Correo';
                    
                    // Si requiere ID, el mensaje de asistencia NO se muestra en este punto
                    if (whatsappMessageBox) {
                        whatsappMessageBox.style.display = 'none';
                    }
                }
            }
            
            // Mostrar/Ocultar el mensaje de WhatsApp para asistencia
            if (whatsappMessageBox) {
                 whatsappMessageBox.style.display = requiresAssistance ? 'block' : 'none';
            }

            // Renderizar Paquetes
            packagesGrid.innerHTML = '';
            if (product.paquetes && product.paquetes.length > 0) {
                product.paquetes.forEach(pkg => {
                    // Usar precios formateados desde el backend si están disponibles, sino usar los crudos
                    const priceVES = pkg.price_ves_formatted || parseFloat(pkg.price_ves).toFixed(2);
                    const priceUSD = pkg.price_usd_formatted || parseFloat(pkg.price_usd).toFixed(2);
                    
                    const packageHtml = `
                        <div class="package-option" 
                            data-package-name="${pkg.nombre}" 
                            data-price-ves="${pkg.price_ves}"
                            data-price-usd="${pkg.price_usd}">
                            <h3>${pkg.nombre}</h3>
                            <p class="price-ves">Bs. <span class="price-value">${priceVES}</span></p>
                            <p class="price-usd">$ <span class="price-value">${priceUSD}</span></p>
                        </div>
                    `;
                    packagesGrid.insertAdjacentHTML('beforeend', packageHtml);
                });
                
                // Adjuntar Event Listeners después de renderizar
                attachPackageEventListeners();
                
                // Actualizar la visualización de precios al cargar (debe estar disponible en script.js)
                // window.dispatchEvent(new CustomEvent('currencyChange', { detail: { currency: localStorage.getItem('selectedCurrency') || 'VES' } }));

            } else {
                packagesGrid.innerHTML = '<p class="empty-message">No hay paquetes disponibles para este juego.</p>';
            }
            
            if (packagesLoading) packagesLoading.style.display = 'none';
            
        } catch (error) {
            console.error('Error al cargar detalles del producto:', error.message);
            productContainer.innerHTML = `<p class="error-message">❌ No pudimos cargar los detalles de este juego.</p>`;
        }
    }


    // 4. Manejo del Formulario de Recarga (MODIFICADO para usar el Carrito)
    if (rechargeForm) {
        rechargeForm.addEventListener('submit', (e) => {
            e.preventDefault();

            // 1. Validación y obtención de datos
            if (!selectedPackage) {
                alert('Por favor, selecciona un paquete de recarga.');
                return;
            }

            const playerIdInput = document.getElementById('player-id-input');
            const playerId = playerIdInput ? playerIdInput.value.trim() : '';
            const requiresId = currentProductData.require_id === true;
            
            // Si requiere ID y el campo está visible/vacío
            if (requiresId && playerIdInput && playerIdInput.style.display !== 'none' && playerId === '') {
                 alert('Por favor, ingresa tu ID de Usuario.');
                 return;
            }

            // 2. Obtener datos del paquete seleccionado
            const packageName = selectedPackage.dataset.packageName;
            const basePriceUSD = parseFloat(selectedPackage.dataset.priceUsd);
            const basePriceVES = parseFloat(selectedPackage.dataset.priceVes);
            const selectedCurrency = localStorage.getItem('selectedCurrency') || 'VES';
            
            // Calcular precio final (Aunque el cálculo real se hace en payment.html, esto es para el objeto del carrito)
            const finalPrice = (selectedCurrency === 'VES') ? basePriceVES : basePriceUSD;
            
            // 3. Crear el objeto del ítem del carrito
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
                // Agregamos el flag de asistencia para usarlo en la página de pago
                requiresAssistance: currentProductData.require_id !== true 
            };

            // 4. Agregar al carrito y guardar (Usando funciones globales de script.js)
            if (typeof getCart === 'function' && typeof saveCart === 'function') {
                const cart = getCart(); 
                cart.push(cartItem);
                saveCart(cart); 

                // 5. Retroalimentación al usuario
                alert(`✅ ¡"${packageName}" agregado al carrito! Tienes ${cart.length} recarga(s) pendiente(s).`);
            } else {
                 // Si las funciones no existen (mal linkeo de scripts), usamos el método antiguo
                 console.error("Funciones de carrito no encontradas. Implementación fallida.");
                 alert('Error al añadir al carrito. Revisa la consola.');
                 return;
            }
            
            // 6. Actualizar UI para añadir otra recarga y limpiar formulario
            rechargeForm.querySelector('.recharge-button').textContent = "Añadir Otra Recarga";
            
            const packageOptions = document.querySelectorAll('.package-option');
            packageOptions.forEach(opt => opt.classList.remove('selected'));
            selectedPackage = null;
            if (playerIdInput) {
                playerIdInput.value = '';
            }
        });
        
        // Al cargar la página, cambiar el texto del botón a "Añadir al Carrito"
        rechargeForm.querySelector('.recharge-button').textContent = "Añadir al Carrito";
    }

    loadProductDetails();
});