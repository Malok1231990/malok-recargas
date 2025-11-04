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
// 🎯 LÓGICA CENTRAL DEL CARRITO DE COMPRAS (GLOBAL Y MODIFICADA)
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

/** Guarda el carrito en el localStorage y actualiza la UI (MODIFICADO). */
function saveCart(cart) {
    try {
        localStorage.setItem('shoppingCart', JSON.stringify(cart));
        updateCartUI(); // Llama a la nueva función que actualiza todo
    } catch (e) {
        console.error("Error al guardar el carrito:", e);
    }
}

/** Elimina un ítem específico del carrito (NUEVO). */
function removeItemFromCart(itemId) {
    let cart = getCart();
    // Filtra el carrito, manteniendo solo los ítems cuyo ID no coincide con el ítem a eliminar
    const newCart = cart.filter(item => item.id !== itemId);
    saveCart(newCart);
}

/**
 * Renderiza el contenido del carrito en el panel lateral y actualiza el contador (NUEVO).
 */
function updateCartUI() {
    const cart = getCart();
    const container = document.getElementById('cart-items-container');
    const countElement = document.getElementById('cart-count');
    const totalAmountElement = document.getElementById('cart-total-amount');
    const totalCurrencyElement = document.getElementById('cart-total-currency');
    const emptyMessage = document.getElementById('cart-empty-message');
    const checkoutBtn = document.getElementById('proceed-to-checkout-btn');
    
    // 1. Actualizar contador de la cabecera
    if (countElement) {
        countElement.textContent = cart.length.toString();
    }

    // Salir si no encontramos los elementos del panel (ej. si no estamos en index.html/product.html)
    if (!container || !totalAmountElement || !checkoutBtn) return;
    
    // 2. Limpiar e inyectar ítems
    container.innerHTML = ''; // Limpiar
    
    // Si la página tiene el emptyMessage (es decir, tiene el sidebar)
    if (emptyMessage) {
        if (cart.length === 0) {
            // Mostrar mensaje de vacío
            emptyMessage.style.display = 'block';
            container.appendChild(emptyMessage);
            totalAmountElement.textContent = 'Bs. 0.00';
            checkoutBtn.disabled = true;
            return;
        }

        emptyMessage.style.display = 'none'; // Ocultar mensaje de vacío
    }

    checkoutBtn.disabled = false;
    
    // Determinar la moneda para la visualización del total
    const selectedCurrency = localStorage.getItem('selectedCurrency') || 'VES';
    const currencySymbol = selectedCurrency === 'VES' ? 'Bs.' : '$';
    
    let total = 0;

    cart.forEach(item => {
        // Usamos el precio final que se calculó al añadir al carrito
        const price = parseFloat(item.finalPrice || 0); 
        total += price;
        
        const itemElement = document.createElement('div');
        itemElement.classList.add('cart-item');
        
        const itemHtml = `
            <div class="cart-item-details">
                <strong>${item.game} - ${item.packageName}</strong>
                <span>ID: ${item.playerId || 'N/A'}</span>
            </div>
            <div class="cart-item-price">
                ${currencySymbol} ${price.toFixed(2)}
            </div>
            <button class="remove-item-btn" data-item-id="${item.id}">&times;</button>
        `;
        itemElement.innerHTML = itemHtml;
        container.appendChild(itemElement);
    });
    
    // 3. Actualizar Total y Moneda
    if (totalCurrencyElement) totalCurrencyElement.textContent = selectedCurrency;
    totalAmountElement.textContent = `${currencySymbol} ${total.toFixed(2)}`;
    
    // 4. Adjuntar eventos para eliminar ítems
    container.querySelectorAll('.remove-item-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const itemId = parseInt(e.currentTarget.dataset.itemId);
            removeItemFromCart(itemId); 
        });
    });
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
        // CORREGIDO: Aseguramos que 'currencyOptionsContainer' exista antes de buscar la opción
        const option = currencyOptionsContainer ? currencyOptionsContainer.querySelector(`[data-value="${selectedCurrency}"]`) : null;
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
            if (currencyOptionsContainer) { // CORREGIDO: Comprobación de existencia
                currencyOptionsContainer.classList.toggle('open');
            }
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
            if (customCurrencySelector && currencyOptionsContainer && !customCurrencySelector.contains(e.target)) {
                currencyOptionsContainer.classList.remove('open');
            }
        });
    }

    // Inicializar la visualización de la moneda al cargar
    if (selectedCurrencyDisplay) { // Solo si el elemento de moneda está presente
        updateCurrencyDisplay();
    }


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
    // 🎯 LÓGICA DEL ÍCONO DEL CARRITO (Panel Sidebar - MODIFICADO)
    // ====================================

    // 1. Inicializar la UI del carrito al cargar
    updateCartUI(); 
    
    // Referencias a los nuevos elementos del panel
    const cartIconLink = document.getElementById('cart-icon-link');
    const sidebar = document.getElementById('cart-sidebar');
    const overlay = document.getElementById('cart-overlay');
    const closeBtn = document.getElementById('close-cart-btn');
    const checkoutBtn = document.getElementById('proceed-to-checkout-btn');

    // Función para abrir el carrito
    function openCart() {
        if (sidebar && overlay) {
            sidebar.classList.add('open');
            overlay.classList.add('open');
            updateCartUI(); // Asegura que los datos estén frescos al abrir
        }
    }

    // Función para cerrar el carrito
    function closeCart() {
        if (sidebar && overlay) {
            sidebar.classList.remove('open');
            overlay.classList.remove('open');
        }
    }

    // 2. Manejar clic en el ícono del carrito para ABRIR
    if (cartIconLink) {
        cartIconLink.addEventListener('click', (e) => {
             e.preventDefault();
             openCart();
        });
    }
    
    // 3. Manejar clic en el botón de CERRAR y el OVERLAY
    if (closeBtn) {
        closeBtn.addEventListener('click', closeCart);
    }
    if (overlay) {
        overlay.addEventListener('click', closeCart);
    }
    
    // 4. Manejar clic en el botón PROCEDER AL PAGO
    if (checkoutBtn) {
        checkoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const cart = getCart();
            if (cart.length > 0) {
                // Redirige a la página de pago con el flag
                window.location.href = 'payment.html?mode=cart';
            } else {
                alert('Tu carrito está vacío.');
                checkoutBtn.disabled = true;
            }
        });
    }
});