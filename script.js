// script.js COMPLETO Y MODIFICADO

// 🎯 FUNCIÓN PARA CARGAR Y APLICAR LA CONFIGURACIÓN DE COLORES
async function applySiteConfig() {
    try {
        // Llama a la Netlify Function que lee Supabase
        // (Asegúrate de que esta función esté implementada en netlify/functions/get-site-config.js)
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


// 🛒 LÓGICA DEL CARRITO (Implementación de esqueleto básico) 🛒
let cartItems = []; // Array que almacenará los productos

/**
 * Renderiza los elementos del carrito en el panel lateral.
 */
function renderCart() {
    const cartList = document.getElementById('cart-items-list');
    const cartTotalAmount = document.getElementById('cart-total-amount');
    const cartCount = document.getElementById('cart-count');
    const checkoutButton = document.getElementById('checkout-button');
    const emptyMessage = document.getElementById('empty-cart-message');

    // 1. Limpiar la lista actual
    cartList.innerHTML = ''; 

    // 2. Mostrar mensaje de vacío si no hay items
    if (cartItems.length === 0) {
        emptyMessage.style.display = 'block';
        cartTotalAmount.textContent = '0.00 Bs.';
        cartCount.textContent = '0';
        checkoutButton.disabled = true;
        cartList.appendChild(emptyMessage);
        return;
    }

    emptyMessage.style.display = 'none';
    let total = 0;

    // 3. Renderizar cada item
    cartItems.forEach((item, index) => {
        const itemElement = document.createElement('div');
        itemElement.className = 'cart-item';
        itemElement.dataset.index = index; // Usamos el índice para identificar al quitar

        const subtotal = item.price * item.quantity;
        total += subtotal;

        itemElement.innerHTML = `
            <div class="cart-item-details">
                <h4>${item.name} (${item.quantity}x)</h4>
                <p>Juego: ${item.game} | Monto: ${subtotal.toFixed(2)} ${item.currency}</p>
            </div>
            <button class="cart-item-remove" data-index="${index}" aria-label="Quitar ${item.name} del carrito">
                <i class="fas fa-trash-alt"></i>
            </button>
        `;

        cartList.appendChild(itemElement);
    });

    // 4. Actualizar total y badge
    cartTotalAmount.textContent = `${total.toFixed(2)} ${cartItems[0]?.currency || 'Bs.'}`;
    cartCount.textContent = cartItems.length.toString();
    checkoutButton.disabled = false;
}


/**
 * Añade un item simulado al carrito para demostración.
 * Esta función debe ser llamada desde el botón de compra en product.html.
 */
function addItemToCart(name, game, price, quantity, currency = 'Bs.') {
    // Busca si el item ya existe
    const existingItem = cartItems.find(item => item.name === name);

    if (existingItem) {
        existingItem.quantity += quantity;
    } else {
        cartItems.push({ name, game, price, quantity, currency });
    }
    
    // Almacenar en localStorage (buena práctica para persistencia)
    localStorage.setItem('malok_cart', JSON.stringify(cartItems));

    renderCart(); // Vuelve a dibujar el carrito
}

/**
 * Quita un item del carrito por su índice.
 */
function removeItemFromCart(index) {
    cartItems.splice(index, 1);
    localStorage.setItem('malok_cart', JSON.stringify(cartItems));
    renderCart();
}

/**
 * Carga el carrito desde localStorage al iniciar.
 */
function loadCartFromStorage() {
    const storedCart = localStorage.getItem('malok_cart');
    if (storedCart) {
        cartItems = JSON.parse(storedCart);
    }
    renderCart();
}

// ---------------------------------------------------------------


document.addEventListener('DOMContentLoaded', () => {
    // Carga la configuración de colores
    applySiteConfig();
    
    // Carga el estado del carrito
    loadCartFromStorage();

    // ---- Lógica para el nuevo selector de moneda personalizado ----
    const customCurrencySelector = document.getElementById('custom-currency-selector');
    const selectedCurrencyDisplay = document.getElementById('selected-currency');
    const currencyOptions = document.getElementById('currency-options');

    if (customCurrencySelector) {
        selectedCurrencyDisplay.addEventListener('click', () => {
            currencyOptions.classList.toggle('open');
            selectedCurrencyDisplay.querySelector('.currency-arrow').classList.toggle('fa-chevron-up');
            selectedCurrencyDisplay.querySelector('.currency-arrow').classList.toggle('fa-chevron-down');
        });

        currencyOptions.addEventListener('click', (e) => {
            const option = e.target.closest('.option');
            if (option) {
                const value = option.dataset.value;
                const newHtml = option.innerHTML;

                // Actualizar el display
                selectedCurrencyDisplay.innerHTML = newHtml + `<i class="fas fa-chevron-down currency-arrow"></i>`;
                
                // Cerrar las opciones
                currencyOptions.classList.remove('open');
                
                // Opcional: Almacenar la selección en localStorage
                localStorage.setItem('selectedCurrency', value); 
                
                // Opcional: Recargar o actualizar la lista de productos/precios
                // loadGames(value); 
                
                // Si estás en la página de producto
                if (window.location.pathname.includes('product.html')) {
                    // Aquí podrías disparar una función para actualizar los precios del producto
                    // updateProductPrices(value); 
                }
            }
        });

        // Cierra el selector si se hace clic fuera
        document.addEventListener('click', (e) => {
            if (!customCurrencySelector.contains(e.target)) {
                currencyOptions.classList.remove('open');
                const arrow = selectedCurrencyDisplay.querySelector('.currency-arrow');
                if (arrow && arrow.classList.contains('fa-chevron-up')) {
                    arrow.classList.remove('fa-chevron-up');
                    arrow.classList.add('fa-chevron-down');
                }
            }
        });
    }

    // ---- Lógica para el botón de Login (Dropdown) ----
    const loginToggleButton = document.getElementById('login-toggle-button');
    const loginDropdown = document.querySelector('.login-dropdown');
    const loginMenu = document.getElementById('login-menu');

    if (loginToggleButton) {
        loginToggleButton.addEventListener('click', () => {
            const isExpanded = loginToggleButton.getAttribute('aria-expanded') === 'true' || false;
            loginToggleButton.setAttribute('aria-expanded', !isExpanded);
            loginMenu.setAttribute('aria-hidden', isExpanded);
            loginDropdown.classList.toggle('active');
        });

        // Cerrar el menú si se hace clic fuera
        document.addEventListener('click', (e) => {
            if (loginDropdown && !loginDropdown.contains(e.target) && loginDropdown.classList.contains('active')) {
                loginToggleButton.setAttribute('aria-expanded', 'false');
                loginMenu.setAttribute('aria-hidden', 'true');
                loginDropdown.classList.remove('active');
            }
        });
    }

    // ---- Lógica para el Panel Lateral del Carrito ----
    const cartButton = document.getElementById('cart-button');
    const closeCartButton = document.getElementById('close-cart-button');
    const cartSidebar = document.getElementById('cart-sidebar');
    const cartOverlay = document.getElementById('cart-overlay');
    const cartItemsList = document.getElementById('cart-items-list');

    function toggleCart(open) {
        if (open === true) {
            cartSidebar.classList.add('open');
            document.body.style.overflow = 'hidden'; // Evita el scroll del body
            cartSidebar.focus();
        } else {
            cartSidebar.classList.remove('open');
            document.body.style.overflow = '';
        }
    }
    
    if (cartButton && cartSidebar) {
        cartButton.addEventListener('click', () => toggleCart(true));
        closeCartButton.addEventListener('click', () => toggleCart(false));
        cartOverlay.addEventListener('click', () => toggleCart(false));

        // Evento para quitar items del carrito
        cartItemsList.addEventListener('click', (e) => {
            const removeButton = e.target.closest('.cart-item-remove');
            if (removeButton) {
                const index = parseInt(removeButton.dataset.index);
                removeItemFromCart(index);
            }
        });

        // **DEMO:** Añadir un item al carrito para probar la funcionalidad
        // setTimeout(() => {
        //     addItemToCart('100 Diamantes', 'Free Fire', 1.50, 1, 'USD');
        //     addItemToCart('500 Monedas', 'TikTok', 30.00, 2, 'Bs.');
        // }, 2000); 
    }


    // ---- Lógica de Búsqueda y Filtrado (en la misma página) ----
    const searchInput = document.querySelector('.search-bar input');
    // MODIFICACIÓN: Apuntamos al ID 'product-grid' donde se inyectarán las tarjetas dinámicamente
    const productGrid = document.getElementById('product-grid'); 

    // Usar el evento 'input' para filtrar en tiempo real a medida que el usuario escribe
    if (searchInput) { // Asegurarse de que el elemento existe
        searchInput.addEventListener('input', () => { 
            const searchTerm = searchInput.value.toLowerCase();

            // Solo ejecutar la lógica de filtrado si estamos en la página que tiene el 'product-grid'
            if (productGrid) {
                // MODIFICACIÓN: Buscamos las tarjetas cada vez para capturar las que se cargaron dinámicamente
                const gameCards = productGrid.querySelectorAll('.game-card'); 

                gameCards.forEach(card => {
                    // Asumiendo que el nombre del juego está en un elemento con la clase .game-title o h2
                    const titleElement = card.querySelector('h2');
                    if (titleElement) {
                        const gameTitle = titleElement.textContent.toLowerCase();
                        
                        if (gameTitle.includes(searchTerm)) {
                            card.style.display = ''; // Mostrar tarjeta
                        } else {
                            card.style.display = 'none'; // Ocultar tarjeta
                        }
                    } else {
                        // Si no encuentra título, asume que debe mostrar si el término está vacío
                         if (searchTerm === '') {
                             card.style.display = ''; 
                         } else {
                             card.style.display = 'none';
                         }
                    }
                });
            }
        });
    }
});

// Exportar la función si es necesario para otros módulos (como load-product-details.js)
// window.addItemToCart = addItemToCart;