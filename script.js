// script.js COMPLETO Y MODIFICADO

// 🎯 FUNCIÓN PARA CARGAR Y APLICAR LA CONFIGURACIÓN DE COLORES
async function applySiteConfig() {
    try {
        // Llama a la Netlify Function que lee Supabase
        const response = await fetch('/.netlify/functions/get-site-config');
        
        if (!response.ok) {
            throw new Error(`Error ${response.status}: No se pudo cargar la configuración del sitio.`);
        }

        const config = await response.json();
        
        // Aplicar las variables CSS al :root (document.documentElement es el <html>)
        for (const [key, value] of Object.entries(config)) {
            // Solo aplica variables que tienen el prefijo --
            if (value && key.startsWith('--')) {
                document.documentElement.style.setProperty(key, value);
            }
        }
        
    } catch (error) {
        console.error('[CLIENTE] Error al aplicar configuración de colores:', error.message);
        // Si falla, el sitio seguirá usando los colores por defecto definidos en style.css
    }
}


// ====================================
// 🎯 LÓGICA CENTRAL DEL CARRITO DE COMPRAS (GLOBAL)
// Estas funciones DEBEN estar fuera de DOMContentLoaded para que otros scripts las usen.
// ====================================

/** Obtiene el carrito del localStorage o un array vacío si no existe. */
function getCart() {
    try {
        const cart = localStorage.getItem('shoppingCart');
        return cart ? JSON.parse(cart) : [];
    } catch (e) {
        console.error("Error al obtener el carrito:", e);
        return [];
    }
}

/** Guarda el carrito en el localStorage y actualiza el contador. */
function saveCart(cart) {
    try {
        localStorage.setItem('shoppingCart', JSON.stringify(cart));
        updateCartCount(); // Actualiza el contador después de guardar
    } catch (e) {
        console.error("Error al guardar el carrito:", e);
    }
}

/** Actualiza el número de ítems en el ícono del carrito. */
function updateCartCount() {
    const cart = getCart();
    const cartCountElement = document.getElementById('cart-count');
    if (cartCountElement) {
        // Muestra el total de items en el carrito
        cartCountElement.textContent = cart.length.toString();
        // Opcional: Ocultar si está vacío
        // cartCountElement.style.display = cart.length > 0 ? 'block' : 'none';
    }
}


document.addEventListener('DOMContentLoaded', () => {
    // Aplicar la configuración de colores al inicio
    // applySiteConfig(); 

    // ---- Lógica para el nuevo selector de moneda personalizado ----
    const customCurrencySelector = document.getElementById('custom-currency-selector');
    const selectedCurrencyDisplay = document.getElementById('selected-currency');
    const currencyOptionsContainer = document.getElementById('currency-options');
    let selectedCurrency = localStorage.getItem('selectedCurrency') || 'VES'; // Moneda por defecto

    // Inicializar la visualización de la moneda
    function updateCurrencyDisplay() {
        const option = currencyOptionsContainer.querySelector(`[data-value="${selectedCurrency}"]`);
        if (option) {
            selectedCurrencyDisplay.innerHTML = option.innerHTML;
        }
        localStorage.setItem('selectedCurrency', selectedCurrency);
        // Disparar evento para que otras partes del código reaccionen
        // NOTA: Se usa 'currencyChange' para ser consistente con el listener en load-product-details.js
        window.dispatchEvent(new CustomEvent('currencyChange', { detail: { currency: selectedCurrency } }));
    }

    // Toggle para mostrar/ocultar las opciones
    if (selectedCurrencyDisplay) {
        selectedCurrencyDisplay.addEventListener('click', () => {
            currencyOptionsContainer.classList.toggle('open');
        });
    }

    // Manejar la selección de una opción
    if (currencyOptionsContainer) {
        currencyOptionsContainer.querySelectorAll('.option').forEach(option => {
            option.addEventListener('click', () => {
                selectedCurrency = option.dataset.value;
                updateCurrencyDisplay();
                currencyOptionsContainer.classList.remove('open');
            });
        });
        
        // Cerrar al hacer clic fuera
        document.addEventListener('click', (e) => {
            if (customCurrencySelector && !customCurrencySelector.contains(e.target)) {
                currencyOptionsContainer.classList.remove('open');
            }
        });
    }

    // Inicializar la visualización de la moneda al cargar
    updateCurrencyDisplay();


    // ---- Lógica para la barra de búsqueda (Solo filtrado en la misma página) ----
    const searchInput = document.querySelector('.search-bar input');
    const productGrid = document.getElementById('product-grid'); 

    if (searchInput) { 
        searchInput.addEventListener('input', () => { 
            const searchTerm = searchInput.value.toLowerCase();

            if (productGrid) {
                const gameCards = productGrid.querySelectorAll('.game-card'); 

                gameCards.forEach(card => {
                    const titleElement = card.querySelector('h2');
                    if (titleElement) {
                        const title = titleElement.textContent.toLowerCase();
                        if (title.includes(searchTerm)) {
                            card.style.display = ''; 
                        } else {
                            card.style.display = 'none'; 
                        }
                    }
                });
            }
        });
    }

    // ====================================
    // 🎯 LÓGICA DEL ÍCONO DEL CARRITO
    // ====================================

    // 1. Inicializar el contador del carrito al cargar
    updateCartCount();
    
    // 2. Manejar clic en el ícono del carrito
    const cartIconLink = document.getElementById('cart-icon-link');
    if (cartIconLink) {
        cartIconLink.addEventListener('click', (e) => {
             e.preventDefault();
             const cart = getCart(); 
             if (cart.length === 0) {
                 alert('Tu carrito está vacío. ¡Agrega una recarga primero!');
             } else {
                 // Redirige a payment.html con un flag para indicar que viene del carrito.
                 window.location.href = 'payment.html?mode=cart';
             }
        });
    }
});