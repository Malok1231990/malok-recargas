// script.js COMPLETO Y CORREGIDO

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

// ------------------------------------------
// ---- LÓGICA DEL CARRITO (Global Helpers) ----
// ------------------------------------------

// Constantes y selectores globales del carrito
const cartSidebar = document.getElementById('cart-sidebar');
const cartIcon = document.getElementById('cart-icon');
const closeCartBtn = document.getElementById('close-cart-btn');
const cartItemsContainer = document.getElementById('cart-items-container');
const cartTotalDisplay = document.getElementById('cart-total');
const checkoutBtn = document.getElementById('checkout-btn');
const cartCountDisplay = document.getElementById('cart-count');

// Helpers para LocalStorage
function getCart() {
    try {
        const cart = JSON.parse(localStorage.getItem('shoppingCart'));
        return Array.isArray(cart) ? cart : [];
    } catch (e) {
        console.error("Error al parsear el carrito de localStorage:", e);
        return [];
    }
}

function saveCart(cart) {
    localStorage.setItem('shoppingCart', JSON.stringify(cart));
}

// Renderizado del carrito en la UI
function renderCart() {
    const cart = getCart();
    const currentCurrency = localStorage.getItem('selectedCurrency') || 'VES';
    const currencySymbol = currentCurrency === 'VES' ? 'Bs.' : '$';
    let total = 0;

    if (cartItemsContainer) {
        cartItemsContainer.innerHTML = '';

        if (cart.length === 0) {
            cartItemsContainer.innerHTML = '<p class="empty-cart-message">Tu carrito está vacío.</p>';
            if (checkoutBtn) checkoutBtn.disabled = true;
        } else {
            cart.forEach(item => {
                const priceKey = currentCurrency === 'VES' ? 'priceVES' : 'priceUSD';
                const price = parseFloat(item[priceKey] || 0);
                total += price;

                const requiresAssistance = item.requiresAssistance ? 
                    `<span class="badge assistance-badge" style="color: red; font-size:0.7em;">Asistencia Req.</span>` : 
                    '';
                    
                const playerIdInfo = item.playerId ? `ID: ${item.playerId}` : '';
                
                const itemHtml = `
                    <div class="cart-item" data-item-id="${item.id}">
                        <div class="cart-item-details">
                            <strong>${item.game}</strong>
                            <span>${item.packageName} (${playerIdInfo})</span>
                            ${requiresAssistance}
                        </div>
                        <div class="cart-item-price">
                            ${currencySymbol} ${price.toFixed(2)}
                        </div>
                        <button class="remove-item-btn" data-id="${item.id}">&times;</button>
                    </div>
                `;
                cartItemsContainer.insertAdjacentHTML('beforeend', itemHtml);
            });
            if (checkoutBtn) checkoutBtn.disabled = false;
        }

        // Mostrar total
        if (cartTotalDisplay) {
            cartTotalDisplay.textContent = `${currencySymbol} ${total.toFixed(2)}`;
        }
        
        // Actualizar contador del carrito
        if (cartCountDisplay) {
            cartCountDisplay.textContent = cart.length;
        }
    }
}

// Remover ítem del carrito
function removeItem(id) {
    let cart = getCart();
    cart = cart.filter(item => item.id !== id);
    saveCart(cart);
    renderCart();
}

// Hacemos global la función para añadir item (usada en load-product-details.js)
window.addToCart = (item) => {
    const cart = getCart();
    // Prevenimos duplicados de recargas idénticas, aunque el ID único ya lo hace por nosotros
    // Es mejor permitir que el usuario añada el mismo paquete varias veces
    cart.push(item); 
    saveCart(cart);
    renderCart();
};

// Hacemos global la función para abrir/cerrar (usada en load-product-details.js y en el evento click)
window.toggleCart = (force) => {
    if (cartSidebar) {
        if (force === true) {
            cartSidebar.classList.add('open');
        } else if (force === false) {
            cartSidebar.classList.remove('open');
        } else {
            cartSidebar.classList.toggle('open');
        }
    }
};


document.addEventListener('DOMContentLoaded', () => {
    // ---- Lógica para el nuevo selector de moneda personalizado ----
    const customCurrencySelector = document.getElementById('custom-currency-selector');
    const selectedCurrencyDisplay = document.getElementById('selected-currency');
    const currencyOptionsDiv = document.getElementById('currency-options');
    const currencyOptions = currencyOptionsDiv ? currencyOptionsDiv.querySelectorAll('.option') : [];

    // Función para actualizar la UI del selector y guardar la moneda
    function updateCurrencyDisplay(value, text, imgSrc) {
        if (selectedCurrencyDisplay) {
            selectedCurrencyDisplay.innerHTML = `<img src="${imgSrc}" alt="${text.split(' ')[2] ? text.split(' ')[2].replace(/[()]/g, '') : 'Flag'}"> <span>${text}</span> <i class="fas fa-chevron-down"></i>`;
        }
        const prevCurrency = localStorage.getItem('selectedCurrency');
        localStorage.setItem('selectedCurrency', value);
        
        // Dispatch custom event solo si la moneda realmente cambió
        if (prevCurrency !== value) {
             window.dispatchEvent(new CustomEvent('currencyChanged', { detail: { currency: value } }));
        }
    }

    // Inicializar el selector con la moneda guardada o por defecto
    const savedCurrency = localStorage.getItem('selectedCurrency') || 'VES'; // Por defecto VES
    let initialText = 'Bs. (VES)';
    let initialImgSrc = 'images/flag_ve.png';
    if (savedCurrency === 'USD') {
        initialText = '$ (USD)';
        initialImgSrc = 'images/flag_us.png';
    }
    updateCurrencyDisplay(savedCurrency, initialText, initialImgSrc);

    // Toggle para abrir/cerrar el selector
    if (selectedCurrencyDisplay) {
        selectedCurrencyDisplay.addEventListener('click', (event) => {
            event.stopPropagation();
            if (currencyOptionsDiv) currencyOptionsDiv.classList.toggle('open');
        });
    }

    // Manejo de la selección de opciones de moneda
    currencyOptions.forEach(option => {
        option.addEventListener('click', function() {
            const value = this.dataset.value;
            const text = this.querySelector('span').textContent;
            const imgSrc = this.querySelector('img').src;

            updateCurrencyDisplay(value, text, imgSrc);
            
            // Cerrar el dropdown
            if (currencyOptionsDiv) currencyOptionsDiv.classList.remove('open');
        });
    });

    // Cierre del dropdown al hacer clic fuera
    document.addEventListener('click', () => {
        if (currencyOptionsDiv) currencyOptionsDiv.classList.remove('open');
    });

    
    // --------------------------------------
    // ---- Lógica del Carrito (Eventos) ----
    // --------------------------------------
    
    // 1. Lógica para remover ítems (usamos delegación de eventos)
    if (cartItemsContainer) {
        cartItemsContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-item-btn')) {
                const itemId = parseInt(e.target.dataset.id);
                removeItem(itemId);
            }
        });
    }


    // 2. Lógica del Botón de Carrito (Abrir/Cerrar)
    if (cartIcon && closeCartBtn) {
        cartIcon.addEventListener('click', () => {
            window.toggleCart();
        });
        
        closeCartBtn.addEventListener('click', () => {
            window.toggleCart(false); // Cierra el carrito
        });
    }

    // 3. Lógica del Botón de Checkout
    if (checkoutBtn) {
        checkoutBtn.addEventListener('click', () => {
            const cart = getCart();
            if (cart.length > 0) {
                // Guardamos el array completo del carrito.
                localStorage.setItem('transactionDetails', JSON.stringify(cart));
                window.location.href = 'payment.html';
            }
        });
    }
    
    // 4. Integración con el cambio de moneda
    // Cuando la moneda cambie, volvemos a renderizar el carrito para actualizar precios.
    window.addEventListener('currencyChanged', renderCart);
    
    // 5. Renderizado Inicial
    renderCart();

    // 🎯 LLAMADA CLAVE: Aplicar la configuración de colores al cargar el sitio. <-- FIX para Error 1
    applySiteConfig(); 
    
    // ---- Lógica de búsqueda (Filtrado en la misma página) ----
    const searchInput = document.querySelector('.search-bar input');
    const productGrid = document.getElementById('product-grid'); 

    // Usar el evento 'input' para filtrar en tiempo real a medida que el usuario escribe
    if (searchInput) { 
        searchInput.addEventListener('input', () => { 
            const searchTerm = searchInput.value.toLowerCase();

            if (productGrid) {
                const gameCards = productGrid.querySelectorAll('.game-card'); 

                gameCards.forEach(card => {
                    const title = card.querySelector('h2').textContent.toLowerCase();
                    const description = card.querySelector('.game-description').textContent.toLowerCase();

                    if (title.includes(searchTerm) || description.includes(searchTerm)) {
                        card.style.display = ''; // Mostrar tarjeta
                    } else {
                        card.style.display = 'none'; // Ocultar tarjeta
                    }
                });
            }
        });
    }
});