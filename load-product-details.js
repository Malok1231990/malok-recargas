// load-product-details.js

document.addEventListener('DOMContentLoaded', () => {
    let selectedPackage = null;
    let currentProductData = null; // Variable para almacenar los datos del producto actual

    // 1. Funciones de ayuda

    // Obtener el valor del parámetro 'slug' de la URL
    function getSlugFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('slug');
    }

    // Actualiza los precios en la UI según la moneda seleccionada
    function updatePackagesUI(currency) {
        if (!currentProductData || !currentProductData.paquetes) return;

        const packageOptionsGrid = document.getElementById('package-options-grid');
        // Usamos el símbolo de moneda correcto
        const currencySymbol = currency === 'VES' ? 'Bs.' : '$';
        const priceKey = currency === 'VES' ? 'precio_ves' : 'precio_usd';

        // Recorrer los paquetes y actualizar el precio
        const packageElements = packageOptionsGrid.querySelectorAll('.package-option');
        packageElements.forEach(element => {
            const price = parseFloat(element.dataset[priceKey]).toFixed(2);
            // Si es la opción seleccionada, el precio final también se actualiza
            if (element === selectedPackage) {
                element.querySelector('.package-price').textContent = `${currencySymbol} ${price}`;
            } else {
                element.querySelector('.package-price').textContent = `${currencySymbol} ${price}`;
            }
        });

        // Actualizar el precio en el botón de compra (si está seleccionado)
        if (selectedPackage) {
             const price = parseFloat(selectedPackage.dataset[priceKey]).toFixed(2);
             document.querySelector('.recharge-button').textContent = `Comprar Ahora (${currencySymbol} ${price})`;
        }
    }
    
    // Función que se encarga de dibujar el HTML del paquete
    function renderPackages(paquetes, currency) {
        const packageOptionsGrid = document.getElementById('package-options-grid');
        packageOptionsGrid.innerHTML = ''; // Limpiamos el mensaje de carga

        const currencySymbol = currency === 'VES' ? 'Bs.' : '$';
        const priceKey = currency === 'VES' ? 'precio_ves' : 'precio_usd';

        paquetes.forEach(paquete => {
            const price = parseFloat(paquete[priceKey]).toFixed(2);
            
            const packageHTML = `
                <div class="package-option" 
                    data-name="${paquete.nombre_paquete}" 
                    data-price-usd="${paquete.precio_usd}" 
                    data-price-ves="${paquete.precio_ves}">
                    <span>${paquete.nombre_paquete}</span>
                    <span class="package-price">${currencySymbol} ${price}</span>
                </div>
            `;
            packageOptionsGrid.insertAdjacentHTML('beforeend', packageHTML);
        });

        // 3. Añadir la lógica de selección y clic
        packageOptionsGrid.querySelectorAll('.package-option').forEach(option => {
            option.addEventListener('click', function() {
                // Quitar la selección a todos
                packageOptionsGrid.querySelectorAll('.package-option').forEach(p => p.classList.remove('selected'));
                // Seleccionar este
                this.classList.add('selected');
                selectedPackage = this;

                // Actualizar el botón de compra con el precio
                const price = parseFloat(this.dataset[priceKey]).toFixed(2);
                document.querySelector('.recharge-button').textContent = `Comprar Ahora (${currencySymbol} ${price})`;
            });
        });
    }

    // 2. Función principal para cargar los detalles del producto

    async function loadProductDetails() {
        const slug = getSlugFromUrl();
        const productContainer = document.getElementById('product-container');

        if (!slug) {
            productContainer.innerHTML = '<h2 class="error-message">❌ Error: No se especificó un producto para recargar.</h2><p style="text-align:center;"><a href="index.html">Volver a la página principal</a></p>';
            document.getElementById('page-title').textContent = 'Error - Malok Recargas';
            return;
        }

        try {
            // Llamar a la Netlify Function con el slug
            const response = await fetch(`/.netlify/functions/get-product-details?slug=${slug}`);
            const data = await response.json();
            
            // Si hay un error 404 o cualquier otro error
            if (!response.ok) {
                productContainer.innerHTML = `<h2 class="error-message">❌ Error ${response.status}: ${data.message || 'Producto no encontrado.'}</h2><p style="text-align:center;"><a href="index.html">Volver al inicio</a></p>`;
                document.getElementById('page-title').textContent = 'Producto No Encontrado - Malok Recargas';
                return;
            }

            currentProductData = data; // Almacenar los datos del producto

            // 3. Rellenar el HTML con los datos
            
            // Título de la página
            document.getElementById('page-title').textContent = `Recargar ${data.nombre} - Malok Recargas`;
            
            // Banner y Título principal
            const bannerHtml = `
                <img src="${data.banner_url || 'images/default_banner.jpg'}" alt="${data.nombre}">
                <div class="banner-overlay">
                    <h1>Recargar ${data.nombre}</h1>
                    <p>${data.descripcion}</p>
                </div>
            `;
            document.getElementById('game-banner-container').innerHTML = bannerHtml;
            
            // Título del formulario
            document.getElementById('form-title').textContent = `Selecciona tu Recarga para ${data.nombre}`;
            
            // Etiqueta del Player ID (Se puede hacer dinámico si tienes ese dato en la tabla 'productos')
            // Por defecto, se deja 'ID de Jugador' como en tu freefire.html
            // Si quisieras cambiarlo para CODM (ej: 'Correo/Contraseña'), habría que añadir ese campo a Supabase.
            
            // Renderizar los paquetes
            const savedCurrency = localStorage.getItem('selectedCurrency') || 'VES';
            renderPackages(data.paquetes, savedCurrency);

            // Quitar el mensaje de carga del contenedor principal
            const loadingMsg = document.getElementById('loading-message');
            if(loadingMsg) loadingMsg.remove();
            
            // 4. Lógica de cambio de moneda (escucha el evento del script.js)
            window.addEventListener('currencyChanged', (event) => {
                updatePackagesUI(event.detail.currency);
            });

            // 5. Lógica de Envío del Formulario (COMO ESTABA EN freefire.html)
            document.getElementById('product-recharge-form').addEventListener('submit', (e) => {
                e.preventDefault();

                if (!selectedPackage) {
                    alert('Por favor, selecciona un plan de recarga.');
                    return;
                }
                
                // Obtener datos del formulario
                const playerId = document.getElementById('player-id-input').value.trim();
                const packageName = selectedPackage.dataset.name;
                const basePriceUSD = parseFloat(selectedPackage.dataset.priceUsd); 
                const basePriceVES = parseFloat(selectedPackage.dataset.priceVes); 
                const selectedCurrency = localStorage.getItem('selectedCurrency') || 'VES';
                
                // Calcular precio final
                const finalPrice = (selectedCurrency === 'VES') ? basePriceVES : basePriceUSD;
                
                // Construir objeto de la transacción para 'payment.html'
                const transactionDetails = {
                    game: data.nombre, // Usamos el nombre dinámico
                    playerId: playerId,
                    packageName: packageName,
                    priceUSD: basePriceUSD.toFixed(2), 
                    finalPrice: finalPrice.toFixed(2), 
                    currency: selectedCurrency 
                };

                localStorage.setItem('transactionDetails', JSON.stringify(transactionDetails));
                window.location.href = 'payment.html';
            });

        } catch (error) {
            console.error('Error al cargar detalles del producto:', error);
            productContainer.innerHTML = '<h2 class="error-message">❌ Error al conectar con el servidor.</h2><p style="text-align:center;">Por favor, recarga la página o vuelve más tarde.</p>';
            document.getElementById('page-title').textContent = 'Error de Carga - Malok Recargas';
        }
    }

    loadProductDetails();
});