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


document.addEventListener('DOMContentLoaded', () => {
    // ---- Lógica para el nuevo selector de moneda personalizado ----
    const customCurrencySelector = document.getElementById('custom-currency-selector');
    const selectedCurrencyDisplay = document.getElementById('selected-currency');
    const currencyOptionsDiv = document.getElementById('currency-options');
    // Asegurarse de que currencyOptionsDiv exista antes de intentar usar querySelectorAll
    const currencyOptions = currencyOptionsDiv ? currencyOptionsDiv.querySelectorAll('.option') : [];

    // Función para actualizar la UI del selector y guardar la moneda
    function updateCurrencyDisplay(value, text, imgSrc) {
        if (selectedCurrencyDisplay) { // Verificar si el elemento existe
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
    if (selectedCurrencyDisplay) { // Asegurarse de que el elemento existe
        selectedCurrencyDisplay.addEventListener('click', (event) => {
            event.stopPropagation(); // Evitar que el clic se propague al document
            if (customCurrencySelector) { // Asegurarse de que customCurrencySelector existe
                customCurrencySelector.classList.toggle('show'); 
            }
        });
    }

    // Manejar la selección de una opción
    currencyOptions.forEach(option => {
        option.addEventListener('click', () => {
            const value = option.dataset.value;
            const text = option.querySelector('span').textContent;
            const imgSrc = option.querySelector('img').src;
            
            updateCurrencyDisplay(value, text, imgSrc);
            if (customCurrencySelector) { // Asegurarse de que customCurrencySelector existe
                customCurrencySelector.classList.remove('show'); 
            }
        });
    });

    // Cerrar el selector si se hace clic fuera de él
    document.addEventListener('click', (event) => {
        if (customCurrencySelector && !customCurrencySelector.contains(event.target)) {
            customCurrencySelector.classList.remove('show'); 
        }
    });

    // ---- Lógica de la barra de búsqueda (filtrado en la misma página) ----
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
                    const gameName = card.querySelector('h2').textContent.toLowerCase(); // Obtener el nombre del juego

                    if (gameName.includes(searchTerm)) {
                        card.style.display = 'flex'; // Mostrar la tarjeta si coincide
                    } else {
                        card.style.display = 'none'; // Ocultar la tarjeta si no coincide
                    }
                });
            }
        });
    }
    
    
    // =========================================================================
    // === Lógica de Carrito (Shopping Cart) y Autenticación (NUEVO) ===
    // =========================================================================

    const cartSidebar = document.getElementById('cart-sidebar');
    const cartIcon = document.getElementById('cart-icon');
    const closeCartBtn = document.getElementById('close-cart-btn');
    const cartItemsContainer = document.getElementById('cart-items');
    const cartTotalElement = document.getElementById('cart-total');
    const cartCountElement = document.getElementById('cart-count');
    const checkoutBtn = document.getElementById('checkout-btn');

    // Lógica de Login/Auth
    const authDropdown = document.getElementById('auth-dropdown');
    const toggleLoginBtn = document.getElementById('toggle-login-btn');


    // --- UTILITY: Gestión de Datos del Carrito ---

    // Función para obtener el carrito de localStorage
    function getCart() {
        const cart = localStorage.getItem('cartItems');
        return cart ? JSON.parse(cart) : [];
    }

    // Función para guardar el carrito en localStorage
    function saveCart(cart) {
        localStorage.setItem('cartItems', JSON.stringify(cart));
    }

    // Función global para agregar un producto al carrito (llamada desde load-product-details.js)
    window.addToCart = function(item) {
        const cart = getCart();
        cart.push(item);
        saveCart(cart);
        renderCart();
    };

    // Función para eliminar un producto por su ID único
    function removeFromCart(itemId) {
        let cart = getCart();
        // Filtramos el array para quitar el ítem que coincida con el ID
        cart = cart.filter(item => item.id !== itemId); 
        saveCart(cart);
        renderCart(); // Volvemos a renderizar
    }

    // --- RENDERIZADO DEL CARRITO ---

    function renderCart() {
        const cart = getCart();
        // **VERIFICACIÓN:** cartItemsContainer puede ser null si no está en la página, aunque debería estar en index.html
        if (!cartItemsContainer) return; 
        
        cartItemsContainer.innerHTML = ''; // Limpiar el contenedor actual
        let total = 0;
        const selectedCurrency = localStorage.getItem('selectedCurrency') || 'VES';
        const currencySymbol = selectedCurrency === 'VES' ? 'Bs.S' : '$';

        if (cart.length === 0) {
            cartItemsContainer.innerHTML = '<p class="empty-cart-message">Tu carrito está vacío.</p>';
            if (cartTotalElement) cartTotalElement.textContent = `${currencySymbol}0.00`;
            if (cartCountElement) cartCountElement.textContent = '0';
            if (checkoutBtn) checkoutBtn.disabled = true;
            return;
        }

        cart.forEach(item => {
            // Determinar el precio basado en la moneda seleccionada
            // Usamos parseFloat y toFixed para asegurar manejo de decimales
            const price = selectedCurrency === 'VES' ? parseFloat(item.priceVES) : parseFloat(item.priceUSD);
            total += price;
            
            const priceDisplay = `${currencySymbol}${price.toFixed(2)}`;
            
            const cartItemDiv = document.createElement('div');
            cartItemDiv.className = 'cart-item';
            cartItemDiv.innerHTML = `
                <div class="cart-item-details">
                    <strong>${item.game}</strong>
                    <span>${item.packageName}</span>
                    <span>ID: ${item.playerId || 'N/A'}</span>
                </div>
                <span class="cart-item-price">${priceDisplay}</span>
                <button class="remove-item-btn" data-item-id="${item.id}">
                    <i class="fas fa-trash-alt"></i>
                </button>
            `;
            cartItemsContainer.appendChild(cartItemDiv);
        });

        // Actualizar Total
        if (cartTotalElement) {
            const totalDisplay = `${currencySymbol}${total.toFixed(2)}`;
            cartTotalElement.textContent = totalDisplay;
        }
        
        // Actualizar Contador
        if (cartCountElement) cartCountElement.textContent = cart.length;
        
        // Habilitar botón de Pago
        if (checkoutBtn) checkoutBtn.disabled = false;
        
        // Adjuntar Event Listeners para el botón de remover
        cartItemsContainer.querySelectorAll('.remove-item-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                // Convertir el ID de string a número (importante, ya que Date.now() es un número)
                const itemId = parseInt(e.currentTarget.dataset.itemId); 
                removeFromCart(itemId);
            });
        });
    }

    // --- TOGGLE y Event Listeners del Carrito y Login ---

    // Función global para abrir/cerrar el carrito (útil para load-product-details.js)
    window.toggleCart = function(forceOpen = false) {
        if (cartSidebar) {
            if (forceOpen) {
                cartSidebar.classList.add('open');
            } else {
                cartSidebar.classList.toggle('open');
            }
        }
    };

    // Event Listeners principales
    
    // 1. Lógica del Botón de Login
    if (toggleLoginBtn && authDropdown) {
        toggleLoginBtn.addEventListener('click', (e) => {
            e.stopPropagation(); 
            authDropdown.classList.toggle('active');
        });
        
        // Cierra el dropdown al hacer clic fuera
        document.addEventListener('click', (event) => {
            if (!authDropdown.contains(event.target) && authDropdown.classList.contains('active')) {
                authDropdown.classList.remove('active');
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

        // 3. Lógica del Botón de Checkout
        if (checkoutBtn) {
            checkoutBtn.addEventListener('click', () => {
                // Guardamos el contenido del carrito en 'transactionDetails' 
                // y redirigimos a 'payment.html'. payment.html deberá procesar una lista.
                const cart = getCart();
                if (cart.length > 0) {
                    // Guardamos el array completo del carrito.
                    localStorage.setItem('transactionDetails', JSON.stringify(cart));
                    // Redirigimos al pago
                    window.location.href = 'payment.html';
                }
            });
        }
    }
    
    // 4. Integración con el cambio de moneda
    // Cuando la moneda cambie, volvemos a renderizar el carrito para actualizar precios.
    window.addEventListener('currencyChanged', renderCart);
    
    // 5. Renderizado Inicial
    renderCart();

    // 🎯 LLAMADA CLAVE: Aplicar la configuración de colores al cargar la página.
    applySiteConfig();
});

// =================================================================
// === MÓDULO DE AUTENTICACIÓN: GOOGLE SIGN-IN ===
// =================================================================

// ❌ ATENCIÓN CRÍTICA: Debes obtener tu ID de Cliente de Google Cloud Console
// y reemplazar 'TU_GOOGLE_CLIENT_ID_AQUÍ' con el valor real para que el botón funcione.
const GOOGLE_CLIENT_ID = '321583559900-b5kvkoleqdrpsup60n00ugls9ujg9jak.apps.googleusercontent.com'; 

/**
 * Función de Callback llamada por el SDK de Google al iniciar sesión.
 * DEBE ser una función global (estar en window) para que el SDK la encuentre.
 */
window.handleCredentialResponse = async (response) => {
    const idToken = response.credential;
    
    console.log("Token JWT de Google recibido. Procesando login...");

    const loginBtnContainer = document.getElementById('google-login-btn');
    if (loginBtnContainer) {
        loginBtnContainer.innerHTML = '<p style="color:var(--text-color); margin: 0;">Iniciando sesión...</p>';
    }

    try {
        // Enviar el token a tu Netlify Function para verificación y creación de sesión.
        // La URL de la función debe ser: /.netlify/functions/process-google-login
        const serverResponse = await fetch('/.netlify/functions/process-google-login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ token: idToken }),
        });

        if (serverResponse.ok) {
            const data = await serverResponse.json();
            
            // Login Exitoso: Guardar la sesión y redirigir
            localStorage.setItem('userSessionToken', data.sessionToken);
            localStorage.setItem('userData', JSON.stringify(data.user)); // Guardar datos del usuario (ej: nombre, email)
            
            alert(`¡Bienvenido(a), ${data.user.name || 'Usuario'}!`);
            window.location.href = 'index.html'; 

        } else {
            const errorData = await serverResponse.json();
            alert(`Error al iniciar sesión: ${errorData.message || 'Token inválido o error del servidor.'}`);
            console.error("Error del servidor en el login:", errorData);
            
            // Re-renderizar el botón si falla
            if (window.google && window.google.accounts && window.google.accounts.id) {
                 initGoogleSignIn(); // Re-inicializar para mostrar el botón de nuevo
            }
        }

    } catch (error) {
        alert('Hubo un problema de conexión con el servidor. Inténtalo de nuevo.');
        console.error("Error de red/cliente:", error);
    }
};


/**
 * Inicializa el SDK de Google y dibuja el botón.
 */
function initGoogleSignIn() {
    const loginButtonElement = document.getElementById('google-login-btn');
    
    if (loginButtonElement && typeof window.google !== 'undefined') { 
        
        // **Verificación del ID de Cliente**
        if (GOOGLE_CLIENT_ID === 'TU_GOOGLE_CLIENT_ID_AQUÍ') {
            loginButtonElement.innerHTML = '<p style="color:red; text-align:center;">❌ CONFIGURACIÓN PENDIENTE: Reemplaza el ID de Google en script.js.</p>';
            return;
        }

        window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: window.handleCredentialResponse, 
            auto_select: false,
            cancel_on_tap_outside: true, 
        });

        // Dibuja el botón
        window.google.accounts.id.renderButton(
            loginButtonElement,
            { 
                theme: "filled_blue", // Un tema más visible
                size: "large", 
                text: "continue_with",
                width: 300 
            } 
        );
        
        console.log("SDK de Google Sign-In inicializado y botón renderizado.");
    }
}

// 💡 Lógica para asegurar que initGoogleSignIn se llame después de que el SDK cargue
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('google-login-btn')) {
        // El SDK de Google se carga de forma asíncrona, esperamos a que esté listo.
        const checkGoogleLoad = setInterval(() => {
            if (typeof window.google !== 'undefined') {
                clearInterval(checkGoogleLoad);
                initGoogleSignIn();
            }
        }, 100);
    }
});