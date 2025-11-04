// load-product-details.js MODIFICADO

document.addEventListener('DOMContentLoaded', () => {
    // Estas variables son accesibles por todas las funciones anidadas (closure)
    let selectedPackage = null;
    let currentProductData = null; // Variable para almacenar los datos del producto actual
    const productContainer = document.getElementById('product-container');
    const rechargeForm = document.getElementById('recharge-form'); // El formulario completo

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
        
        // Habilita el botón de acción si hay un paquete seleccionado
        const actionButton = document.getElementById('add-to-cart-button');
        if (actionButton) {
            actionButton.disabled = false;
            actionButton.textContent = 'Añadir al Carrito'; // Opcional: actualiza el texto
        }
    }
    
    // Función para adjuntar eventos de clic a los paquetes y manejar la selección inicial
    function attachPackageEventListeners() {
        const packageOptions = document.querySelectorAll('.package-option');
        
        // 1. Manejo de la selección de paquetes
        packageOptions.forEach(option => {
            // Asegúrate de remover listeners antiguos si fuera necesario
            option.removeEventListener('click', handlePackageClick); 
            option.addEventListener('click', handlePackageClick);
        });
        
        // 2. Manejo de la selección inicial (si aplica)
        // No hacemos selección inicial a menos que ya hubiera un estado guardado.
        
        // Deshabilitar el botón de acción al inicio
        const actionButton = document.getElementById('add-to-cart-button');
        if (actionButton) {
             actionButton.disabled = true;
        }
    }

    // Función para renderizar el ID / Input de Correo
    function renderPlayerIdInput(requireId, idPlaceholder) {
        const playerIdDiv = document.getElementById('player-id-div');
        const playerIdInput = document.getElementById('player-id-input');
        const playerIdLabel = document.getElementById('player-id-label');
        const whatsappMessage = document.getElementById('whatsapp-info-message');

        if (!playerIdDiv || !playerIdInput || !playerIdLabel || !whatsappMessage) return;

        // Si el juego requiere ID (recarga directa)
        if (requireId === true) {
            playerIdDiv.style.display = 'block';
            playerIdLabel.textContent = 'Ingresa tu ID de Usuario (Requerido)';
            playerIdInput.placeholder = idPlaceholder || 'Ej: 123456789';
            playerIdInput.required = true;
            whatsappMessage.style.display = 'none';

        } else if (requireId === false) {
             // Si el juego NO requiere ID (asistencia o recarga por correo/link)
            playerIdDiv.style.display = 'block'; // Mostrar el campo de ID/Correo
            playerIdLabel.textContent = 'Correo/ID de Usuario (Opcional)';
            playerIdInput.placeholder = idPlaceholder || 'Tu Correo o ID de Referencia';
            playerIdInput.required = false;
            whatsappMessage.style.display = 'block'; // Mostrar mensaje de asistencia
        
        } else {
             // Si el juego no requiere ningún input (e.g., solo tarjetas de regalo)
             playerIdDiv.style.display = 'none';
             whatsappMessage.style.display = 'none';
        }
    }


    // 2. Función Principal: Cargar los detalles del producto
    async function loadProductDetails() {
        const slug = getSlugFromUrl();
        if (!slug || !productContainer) {
            // Opcional: Redirigir a la página de inicio o mostrar error
            // window.location.href = 'index.html'; 
            return; 
        }

        // Mostrar un mensaje de carga inicial
        productContainer.innerHTML = `<p class="loading-message"><i class="fas fa-spinner fa-spin"></i> Cargando detalles del producto...</p>`;
        document.getElementById('page-title').textContent = 'Cargando...';

        try {
            // Llamar a una función que obtenga el detalle del producto (simulado aquí)
            const response = await fetch(`/.netlify/functions/get-product-details?slug=${slug}`);
            
            if (!response.ok) {
                throw new Error(`Error ${response.status}: No se pudo cargar el producto.`);
            }

            const product = await response.json();
            currentProductData = product; // Guardar los datos para usarlos en el formulario
            
            // 1. Renderizar la información principal
            document.getElementById('page-title').textContent = product.nombre;
            productContainer.innerHTML = `
                <div class="product-header">
                    <img src="${product.banner_url || 'images/default_banner.jpg'}" alt="${product.nombre}">
                    <div class="product-info">
                        <h1 id="product-name">${product.nombre}</h1>
                        <p class="product-description">${product.descripcion || 'Recarga fácil y rápido con Malok Recargas.'}</p>
                        <div class="min-price">Desde: <span id="min-price-display">${product.min_price_ves} Bs.</span></div>
                    </div>
                </div>
                `;

            // 2. Renderizar las opciones de paquetes
            const packageGrid = document.getElementById('package-options-grid');
            if (packageGrid) {
                packageGrid.innerHTML = ''; // Limpiar mensaje de carga
                
                if (product.packages && product.packages.length > 0) {
                    product.packages.sort((a, b) => a.price_ves - b.price_ves); // Ordenar por precio
                    product.packages.forEach(pkg => {
                        packageGrid.insertAdjacentHTML('beforeend', `
                            <div class="package-option" 
                                data-package-name="${pkg.name}" 
                                data-price-usd="${pkg.price_usd}" 
                                data-price-ves="${pkg.price_ves}">
                                
                                <h4>${pkg.name}</h4>
                                <p class="price-display">
                                    <span class="price-ves">${pkg.price_ves.toFixed(2)} Bs.</span> / <span class="price-usd">${pkg.price_usd.toFixed(2)} $</span>
                                </p>
                            </div>
                        `);
                    });
                } else {
                     packageGrid.innerHTML = `<p class="empty-message">No hay paquetes disponibles para este juego.</p>`;
                }
            }
            
            // 3. Renderizar el input de ID
            renderPlayerIdInput(product.require_id, product.id_placeholder);

            // 4. Adjuntar los listeners
            attachPackageEventListeners();

        } catch (error) {
            console.error('Error al cargar detalles del producto:', error.message);
            productContainer.innerHTML = `<p class="error-message">❌ Lo sentimos, no pudimos cargar los detalles del producto.</p>`;
        }
    }


    // 3. Lógica del Formulario: CAMBIO CLAVE AÑADIR AL CARRITO
    if (rechargeForm) {
        // Aseguramos que el botón de submit tenga un ID para referenciarlo
        const submitButton = rechargeForm.querySelector('button[type="submit"]');
        if (submitButton) {
            submitButton.id = 'add-to-cart-button'; // Añadimos un ID para fácil referencia
        }

        rechargeForm.addEventListener('submit', function(e) {
            e.preventDefault(); // Detener el envío del formulario a payment.html

            // 1. Validar la selección
            if (!selectedPackage) {
                alert('Por favor, selecciona un paquete de recarga.');
                return;
            }

            // 2. Validar el ID (si es requerido)
            const playerIdInput = document.getElementById('player-id-input');
            const playerId = playerIdInput ? playerIdInput.value.trim() : '';

            if (currentProductData && currentProductData.require_id === true && !playerId) {
                alert('El ID de usuario es obligatorio para esta recarga.');
                playerIdInput.focus();
                return;
            }
            
            // 3. Obtener datos del paquete seleccionado
            const packageName = selectedPackage.dataset.packageName;
            const basePriceUSD = parseFloat(selectedPackage.dataset.priceUsd);
            const basePriceVES = parseFloat(selectedPackage.dataset.priceVes);
            const selectedCurrency = localStorage.getItem('selectedCurrency') || 'VES';
            
            // 4. Calcular precio final
            const finalPrice = (selectedCurrency === 'VES') ? basePriceVES : basePriceUSD;
            const finalCurrencySymbol = (selectedCurrency === 'VES') ? 'Bs.' : 'USD';
            
            // 5. LLAMAR A LA FUNCIÓN DEL CARRITO (Definida en script.js)
            
            // Verificamos si la función global existe (la definimos en script.js)
            if (typeof window.addItemToCart === 'function') {
                window.addItemToCart(
                    `${packageName} (${finalCurrencySymbol})`, // Nombre del item
                    currentProductData ? currentProductData.nombre : 'Juego Desconocido', // Nombre del juego
                    finalPrice, // Precio por unidad
                    1, // Cantidad (siempre 1 en esta lógica simple)
                    finalCurrencySymbol // Moneda
                );
                
                // Opcional: Feedback al usuario y abrir carrito
                alert(`"${packageName}" ha sido añadido a tu carrito.`);
                
                // Función para abrir el carrito (definida en script.js)
                if (typeof window.toggleCart === 'function') {
                    window.toggleCart(true); 
                }

            } else {
                console.error("Error: Función 'addItemToCart' no encontrada. Asegúrate que script.js esté cargado.");
            }
            
            // Limpiar la selección (Opcional)
            selectedPackage.classList.remove('selected');
            selectedPackage = null;
            submitButton.disabled = true;
            if (playerIdInput) playerIdInput.value = '';

        });
    }

    loadProductDetails();
});