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

        // Asegurarse de que el precio en el botón de compra también se actualice si hay un paquete seleccionado
        if (selectedPackage) {
            const finalPriceDisplay = selectedPackage.querySelector('.package-price').textContent;
            document.querySelector('.recharge-button').textContent = `Comprar Ahora (${finalPriceDisplay})`;
        }
    }
    
    // Función para renderizar el contenido del producto
    function renderProductDetails(data) {
        // Guardar los datos del producto
        currentProductData = data;
        const productContainer = document.getElementById('product-details-container');
        const pageTitle = document.getElementById('page-title');
        
        // 1. Actualizar el título de la página
        pageTitle.textContent = `${data.nombre} - Malok Recargas`;

        // 2. Renderizar la imagen y descripción
        productContainer.innerHTML = `
            <div class="product-banner" style="background-image: url('${data.banner_url || 'images/default_banner.jpg'}');">
                <div class="product-overlay">
                    <h1>Recargar ${data.nombre}</h1>
                    <p>${data.descripcion}</p>
                </div>
            </div>
            <div class="product-info-card">
                <p class="section-title">Información Importante:</p>
                <ul>
                    <li><i class="fas fa-check-circle"></i> Recarga directa a tu ID de Jugador.</li>
                    <li><i class="fas fa-check-circle"></i> Entrega en minutos (sujeto a verificación de pago).</li>
                    <li><i class="fas fa-shield-alt"></i> 100% seguro y garantizado.</li>
                </ul>
                <p class="section-title">Pasos para Recargar:</p>
                <ol>
                    <li>Ingresa tu ID de Jugador.</li>
                    <li>Selecciona el plan de recarga deseado.</li>
                    <li>Haz clic en "Comprar Ahora" para ir a la página de pago.</li>
                </ol>
            </div>
        `;

        // 3. Renderizar las opciones de paquetes
        const packageOptionsGrid = document.getElementById('package-options-grid');
        packageOptionsGrid.innerHTML = ''; // Limpiar el mensaje de carga

        if (data.paquetes && data.paquetes.length > 0) {
            data.paquetes.forEach(pkg => {
                const packageElement = document.createElement('div');
                packageElement.className = 'package-option';
                packageElement.dataset.priceUsd = pkg.precio_usd.toFixed(2);
                packageElement.dataset.priceVes = pkg.precio_ves.toFixed(2);
                packageElement.dataset.packageName = pkg.nombre_paquete;
                
                packageElement.innerHTML = `
                    <p class="package-name">${pkg.nombre_paquete}</p>
                    <p class="package-price"></p>
                `;
                packageOptionsGrid.appendChild(packageElement);
            });
            
            // 4. Configurar la lógica de selección y listeners
            const allPackageOptions = packageOptionsGrid.querySelectorAll('.package-option');
            allPackageOptions.forEach(option => {
                option.addEventListener('click', function() {
                    // Deseleccionar el anterior
                    if (selectedPackage) {
                        selectedPackage.classList.remove('selected');
                    }
                    // Seleccionar el nuevo
                    selectedPackage = this;
                    selectedPackage.classList.add('selected');
                    
                    // Actualizar el botón de compra con el precio
                    const priceText = selectedPackage.querySelector('.package-price').textContent;
                    document.querySelector('.recharge-button').textContent = `Comprar Ahora (${priceText})`;
                });
            });

            // 5. Inicializar la UI con la moneda actual
            const initialCurrency = localStorage.getItem('selectedCurrency') || 'VES';
            updatePackagesUI(initialCurrency);
            
            // 6. Listener para cambios de moneda global
            window.addEventListener('currencyChanged', (e) => {
                updatePackagesUI(e.detail.currency);
            });

        } else {
            packageOptionsGrid.innerHTML = '<p class="empty-message">No hay planes de recarga disponibles para este juego en este momento.</p>';
        }
    }

    // 2. Función principal para cargar los detalles del producto
    async function loadProductDetails() {
        const slug = getSlugFromUrl();
        const productContainer = document.getElementById('product-details-container');
        
        if (!slug) {
            productContainer.innerHTML = '<h2 class="error-message">❌ Producto no especificado.</h2><p style="text-align:center;">Por favor, selecciona un juego de la página principal.</p>';
            document.getElementById('page-title').textContent = 'Error - Malok Recargas';
            return;
        }

        try {
            // Llamada a la Netlify Function que lee el producto por slug
            const response = await fetch(`/.netlify/functions/get-product-details?slug=${slug}`);
            
            if (response.status === 404) {
                productContainer.innerHTML = '<h2 class="error-message">❌ Juego no encontrado.</h2><p style="text-align:center;">El juego que buscas no está disponible actualmente.</p>';
                document.getElementById('page-title').textContent = '404 No Encontrado - Malok Recargas';
                return;
            }

            if (!response.ok) {
                throw new Error(`Error ${response.status}: No se pudieron cargar los detalles del producto.`);
            }

            const data = await response.json();
            
            // Renderizar los detalles y paquetes
            renderProductDetails(data);
            
            // 3. Listener del formulario de compra
            const rechargeForm = document.getElementById('recharge-form');
            rechargeForm.addEventListener('submit', function(e) {
                e.preventDefault();
                
                const playerId = document.getElementById('player-id-input').value.trim();
                
                if (!playerId) {
                    alert('Por favor, ingresa tu ID de Jugador.');
                    return;
                }

                if (selectedPackage) {
                    const packageName = selectedPackage.dataset.packageName;
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
                } else {
                    alert('Por favor, selecciona un plan de recarga.');
                }
            });

        } catch (error) {
            console.error('Error al cargar detalles del producto:', error);
            productContainer.innerHTML = '<h2 class="error-message">❌ Error al conectar con el servidor.</h2><p style="text-align:center;">Por favor, recarga la página o vuelve más tarde.</p>';
            document.getElementById('page-title').textContent = 'Error de Carga - Malok Recargas';
        }
    }

    loadProductDetails();
});