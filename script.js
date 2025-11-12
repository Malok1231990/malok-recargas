// script.js COMPLETO Y CORREGIDO (Versión Final con Corrección de Precios USDM en Carrito)

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
        
        // 🟢 CORRECCIÓN CLAVE: Despachar un evento al finalizar la carga de la configuración
        document.dispatchEvent(new CustomEvent('siteConfigLoaded')); 
        
    } catch (error) {
        console.error('[CLIENTE] Error al aplicar configuración de colores:', error.message);
        // Si falla, el sitio seguirá usando los colores por defecto definidos en style.css
    }
}


// =================================================================
// === NUEVA FUNCIÓN CLAVE: REFRESCAR SALDO DESDE EL SERVIDOR ===
// =================================================================

/**
 * Llama a la Netlify Function '/.netlify/functions/get-wallet-balance' 
 * para obtener el saldo más reciente, actualiza localStorage y refresca la UI.
 * * * 🔑 Esta función debe ser llamada inmediatamente después de que se 
 * * confirme una recarga exitosa del saldo del cliente.
 */
window.fetchWalletBalanceAndRefreshUserData = async function() {
    const sessionToken = localStorage.getItem('userSessionToken');
    const userDataJson = localStorage.getItem('userData');
    
    if (!sessionToken || !userDataJson) {
        console.log('[BALANCE] Usuario no logueado. Saltando refresco de saldo.');
        return false;
    }

    try {
        // Llama a la Netlify Function (el token de sesión debe enviarse en los headers)
        const response = await fetch('/.netlify/functions/get-wallet-balance', {
            method: 'GET',
            // El token de autenticación (JWT) debería ser manejado por Netlify Identity
            // al usar la función, o debes pasarlo explícitamente en el header 'Authorization'.
        });
        
        if (!response.ok) {
            console.error('[BALANCE] Error del servidor al obtener saldo:', response.status);
            return false;
        }

        const data = await response.json();
        const newBalance = parseFloat(data.saldo || 0.00).toFixed(2);
        
        // 1. Obtener los datos actuales del usuario
        const currentData = JSON.parse(userDataJson);
        
        // 2. Actualizar el saldo en el objeto de usuario
        currentData.balance = newBalance;
        
        // 3. Sobreescribir el localStorage con el nuevo saldo
        localStorage.setItem('userData', JSON.stringify(currentData)); 
        
        // 4. Forzar la re-renderización de la UI para mostrar el saldo actualizado
        checkUserSessionAndRenderUI();
        
        console.log(`[BALANCE] Saldo actualizado en UI: $${newBalance}`);
        return true;

    } catch (error) {
        console.error('[BALANCE] Error de red/cliente al refrescar saldo:', error);
        return false;
    }
}


// =================================================================
// === MÓDULO DE AUTENTICACIÓN: GOOGLE SIGN-IN & SESIÓN ===
// =================================================================

// ⚠️ ATENCIÓN: El CLIENT_ID es un identificador público.
const GOOGLE_CLIENT_ID = '321583559900-b5kvkoleqdrpsup60n00ugls9ujg9jak.apps.googleusercontent.com'; 

/**
 * Función CLAVE para verificar la sesión en localStorage y actualizar la UI.
 * @returns {boolean} True si hay una sesión activa.
 */
function checkUserSessionAndRenderUI() {
    const sessionToken = localStorage.getItem('userSessionToken');
    const userDataJson = localStorage.getItem('userData');
    const isLoggedIn = sessionToken && userDataJson;
    
    // Elementos del DOM de la Billetera (NUEVOS)
    const walletContainer = document.getElementById('wallet-container'); 
    const virtualBalanceElement = document.getElementById('virtual-balance'); 

    // Elementos del DOM de Auth (Existentes)
    const toggleLoginBtn = document.getElementById('toggle-login-btn');
    const authDisplayName = document.getElementById('auth-display-name'); 
    const authUserPicture = document.getElementById('auth-user-picture');
    const googleLoginBtnContainer = document.getElementById('google-login-btn');
    const logoutBtn = document.getElementById('logout-btn');

    // Selector para el ícono genérico
    const genericIcon = toggleLoginBtn ? toggleLoginBtn.querySelector('.fas.fa-user-circle') : null;
    
    if (isLoggedIn) {
        // SESIÓN ACTIVA
        const userData = JSON.parse(userDataJson);
        const userName = userData.name || userData.email || 'Mi Cuenta'; 

        if (toggleLoginBtn) {
            // 1. Mostrar la imagen de perfil de Google
            if (authUserPicture) {
                authUserPicture.src = userData.picture || 'images/default_user.png';
                authUserPicture.style.display = 'block';
            }
            
            // 2. Ocultar el ícono de usuario genérico
            if (genericIcon) genericIcon.style.display = 'none';

            // 3. Actualizar el nombre en el dropdown
            if (authDisplayName) {
                authDisplayName.textContent = userName;
            }
            
            // 4. Mostrar el botón de Cerrar Sesión y ocultar el contenedor de Google (si existe)
            if (logoutBtn) logoutBtn.style.display = 'block';
            if (googleLoginBtnContainer) googleLoginBtnContainer.style.display = 'none';
        }
        
        // 5. Lógica de la Billetera (NUEVO)
        if (walletContainer && virtualBalanceElement) {
            // Usamos el saldo real del usuario. El backend garantiza que siempre es un string de 2 decimales
            // 🔑 CLAVE: El valor se lee DIRECTAMENTE de localStorage, que fue actualizado por la nueva función.
            const balance = userData.balance || '0.00'; 
            virtualBalanceElement.textContent = `$. ${balance}`;
            walletContainer.style.display = 'flex'; // Mostrar la billetera
        }


    } else {
        // SESIÓN INACTIVA
        if (toggleLoginBtn) {
            // 1. Mostrar el ícono de usuario genérico
            if (genericIcon) genericIcon.style.display = 'block';
            
            // 2. Ocultar la imagen de perfil
            if (authUserPicture) {
                authUserPicture.style.display = 'none';
            }
        }
        
        // 3. Restaurar el texto del dropdown a "Iniciar Sesión"
        if (authDisplayName) authDisplayName.textContent = 'Iniciar Sesión';
        
        // 4. Ocultar el botón de Cerrar Sesión. El botón de Google se manejará en initGoogleSignIn
        if (logoutBtn) logoutBtn.style.display = 'none';

        // 5. Ocultar la Billetera (NUEVO)
        if (walletContainer) {
            walletContainer.style.display = 'none';
        }
    }
    
    return isLoggedIn;
}

/**
 * Función de Callback llamada por el SDK de Google al iniciar sesión.
 */
window.handleCredentialResponse = async (response) => {
    const idToken = response.credential;
    
    const loginBtnContainer = document.getElementById('google-login-btn');
    if (loginBtnContainer) {
        loginBtnContainer.innerHTML = '<p style="color:var(--text-color); margin: 0; text-align: center;">Iniciando sesión...</p>';
    }

    try {
        // Enviar el token a tu Netlify Function para verificación.
        const serverResponse = await fetch('/.netlify/functions/process-google-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: idToken }),
        });

        if (serverResponse.ok) {
            const data = await serverResponse.json();
            
            // Login Exitoso: Guardar la sesión
            localStorage.setItem('userSessionToken', data.sessionToken);
            // El backend ya garantiza que 'balance' existe
            localStorage.setItem('userData', JSON.stringify(data.user)); 
            
            // Mostrar el mensaje de bienvenida
            const userName = data.user.name || 'Usuario';
            
            // Usamos un pequeño timeout para asegurarnos de que el alert se muestre antes de la recarga
            setTimeout(() => {
                    alert(`¡Bienvenido(a), ${userName}! Has iniciado sesión correctamente.`);
                    
                    // 🎯 CORRECCIÓN: Redirigir explícitamente a index.html
                    window.location.href = 'index.html'; 
            }, 50);

        } else {
            const errorData = await serverResponse.json();
            alert(`Error al iniciar sesión: ${errorData.message || 'Token inválido o error del servidor.'}`);
            console.error("Error del servidor en el login:", errorData);
            
            // Si falla, re-inicializar el botón
            if (window.google && window.google.accounts && window.google.accounts.id) {
                    initGoogleSignIn(true); // Forzar la renderización del botón
            }
        }

    } catch (error) {
        alert('Hubo un problema de conexión con el servidor. Inténtalo de nuevo.');
        console.error("Error de red/cliente:", error);
    }
};

/**
 * Inicializa el SDK de Google y dibuja el botón.
 * @param {boolean} forceRender Si es true, fuerza la renderización aunque haya sesión.
 */
function initGoogleSignIn(forceRender = false) {
    const loginButtonElement = document.getElementById('google-login-btn');
    
    // Si ya hay sesión activa Y no estamos forzando la renderización (ej. después de un error), salir.
    if (!forceRender && checkUserSessionAndRenderUI()) {
        if (loginButtonElement) loginButtonElement.style.display = 'none';
        return;
    }
    
    if (loginButtonElement && typeof window.google !== 'undefined') { 
        
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
                theme: "filled_blue", 
                size: "large", 
                text: "continue_with",
                width: 300 
            } 
        );
        loginButtonElement.style.display = 'block';
    }
}


// 💡 Función global para obtener la moneda guardada.
window.getCurrentCurrency = function() {
    // Retorna la moneda guardada ('USD', 'USDM' o 'VES'), o 'VES' como valor por defecto.
    return localStorage.getItem('selectedCurrency') || 'VES'; 
};
// -----------------------------------------------------------------


document.addEventListener('DOMContentLoaded', () => {
    // ---- Lógica para el nuevo selector de moneda personalizado ----
    const customCurrencySelector = document.getElementById('custom-currency-selector');
    const selectedCurrencyDisplay = document.getElementById('selected-currency');
    const currencyOptionsDiv = document.getElementById('currency-options');
    // Aseguramos que los elementos existan antes de hacer querySelectorAll
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
    const savedCurrency = localStorage.getItem('selectedCurrency') || 'VES'; 
    let initialText = 'Bs. (VES)';
    let initialImgSrc = 'images/flag_ve.png';

    if (savedCurrency === 'USD') {
        initialText = '$ (USD)';
        initialImgSrc = 'images/flag_us.png';
    } else if (savedCurrency === 'USDM') { // 🎯 Inicialización para USDM
        initialText = '$ (Usd Malok)';
        initialImgSrc = 'images/favicon.ico';
    }
    updateCurrencyDisplay(savedCurrency, initialText, initialImgSrc);

    // Toggle para abrir/cerrar el selector
    if (selectedCurrencyDisplay) { 
        selectedCurrencyDisplay.addEventListener('click', (event) => {
            event.stopPropagation(); 
            if (customCurrencySelector) { 
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
            if (customCurrencySelector) { 
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

    // ---- Lógica de la barra de búsqueda (filtrado) ----
    const searchInput = document.querySelector('.search-bar input');
    const productGrid = document.getElementById('product-grid'); 

    if (searchInput) { 
        searchInput.addEventListener('input', () => { 
            const searchTerm = searchInput.value.toLowerCase();

            if (productGrid) {
                const gameCards = productGrid.querySelectorAll('.game-card'); 

                gameCards.forEach(card => {
                    const gameName = card.querySelector('h2').textContent.toLowerCase(); 

                    if (gameName.includes(searchTerm)) {
                        card.style.display = 'flex'; 
                    } else {
                        card.style.display = 'none'; 
                    }
                });
            }
        });
    }
    
    
    // =========================================================================
    // === Lógica de Carrito (Shopping Cart) y Autenticación ===
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
    const logoutBtn = document.getElementById('logout-btn');
    
    // El enlace "Iniciar Sesión" / Nombre de Usuario
    const authDisplayLink = document.getElementById('auth-display-name');


    // --- UTILITY: Gestión de Datos del Carrito ---

    function getCart() {
        const cart = localStorage.getItem('cartItems');
        return cart ? JSON.parse(cart) : [];
    }

    function saveCart(cart) {
        localStorage.setItem('cartItems', JSON.stringify(cart));
    }

    // Función global para agregar un producto al carrito
    window.addToCart = function(item) {
        const cart = getCart();
        cart.push(item);
        saveCart(cart);
        renderCart();
    };

    function removeFromCart(itemId) {
        let cart = getCart();
        cart = cart.filter(item => item.id !== itemId); 
        saveCart(cart);
        renderCart(); 
    }

    // --- RENDERIZADO DEL CARRITO ---

    function renderCart() {
        const cart = getCart();
        if (!cartItemsContainer) return; 
        
        cartItemsContainer.innerHTML = ''; 
        let total = 0;
        const selectedCurrency = localStorage.getItem('selectedCurrency') || 'VES';
        // CLAVE: USD y USDM usan el mismo símbolo '$'
        const currencySymbol = selectedCurrency === 'VES' ? 'Bs.S' : '$';

        if (cart.length === 0) {
            cartItemsContainer.innerHTML = '<p class="empty-cart-message">Tu carrito está vacío.</p>';
            if (cartTotalElement) cartTotalElement.textContent = `${currencySymbol}0.00`;
            if (cartCountElement) cartCountElement.textContent = '0';
            if (checkoutBtn) checkoutBtn.disabled = true;
            return;
        }

        cart.forEach(item => {
            // Aseguramos que los precios sean números antes de sumar
            let price;
            
            // 🎯 CORRECCIÓN CLAVE: Selecciona el campo de precio según la moneda.
            if (selectedCurrency === 'VES') {
                price = parseFloat(item.priceVES || 0);
            } else if (selectedCurrency === 'USDM') {
                // USA priceUSDM para la moneda USDM (corrigiendo el error de usar priceUSD)
                price = parseFloat(item.priceUSDM || 0); 
            } else { // Si es 'USD' (o cualquier otra no VES/USDM)
                price = parseFloat(item.priceUSD || 0);
            }
            
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

        if (cartTotalElement) {
            const totalDisplay = `${currencySymbol}${total.toFixed(2)}`;
            cartTotalElement.textContent = totalDisplay;
        }
        
        if (cartCountElement) cartCountElement.textContent = cart.length;
        
        if (checkoutBtn) checkoutBtn.disabled = false;
        
        cartItemsContainer.querySelectorAll('.remove-item-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const itemId = parseInt(e.currentTarget.dataset.itemId); 
                removeFromCart(itemId);
            });
        });
    }

    // --- TOGGLE y Event Listeners del Carrito y Login/Logout ---

    // Función global para abrir/cerrar el carrito
    window.toggleCart = function(forceOpen = false) {
        if (cartSidebar) {
            if (forceOpen) {
                cartSidebar.classList.add('open');
            } else {
                cartSidebar.classList.toggle('open');
            }
        }
    };

    // 1. Lógica del Botón de Login/Usuario (Toggle Dropdown)
    if (toggleLoginBtn && authDropdown) {
        toggleLoginBtn.addEventListener('click', (e) => {
            e.stopPropagation(); 
            authDropdown.classList.toggle('active');
        });
        
        document.addEventListener('click', (event) => {
            // Si el clic es fuera del dropdown y el dropdown está activo, ciérralo.
            if (authDropdown && !authDropdown.contains(event.target) && authDropdown.classList.contains('active')) {
                authDropdown.classList.remove('active');
            }
        });
    }
    
    // 2. Lógica del Botón de Cerrar Sesión (Logout)
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            // 1. Limpiar la sesión en localStorage
            localStorage.removeItem('userSessionToken');
            localStorage.removeItem('userData');
            
            // 2. Forzar la re-detección y actualización de la UI
            checkUserSessionAndRenderUI();
            
            // 3. Opcional: Cerrar el dropdown después de logout
            if (authDropdown) authDropdown.classList.remove('active');
            
            alert('¡Sesión cerrada con éxito!');
            
            // 4. Redirigir a index si no estamos allí o recargar para resetear el estado
            if (window.location.pathname.includes('index.html') === false) {
                 window.location.href = 'index.html'; 
            } else {
                 // Si estamos en index, recargar para resetear el estado de la página
                 window.location.reload(); 
            }
        });
    }
    
    // 3. Lógica del Enlace "Mi Cuenta" / "Iniciar Sesión" 
    if (authDisplayLink) {
        authDisplayLink.addEventListener('click', (e) => {
            e.preventDefault(); 
            
            // Verificamos si el usuario está logueado (el texto NO es "Iniciar Sesión")
            const isUserLoggedIn = authDisplayLink.textContent.trim() !== 'Iniciar Sesión';

            if (isUserLoggedIn) {
                // Si el usuario está logueado (muestra su nombre), lo redirigimos a su cuenta/perfil
                if (authDropdown) authDropdown.classList.remove('active'); // Cerramos el dropdown
                // Usamos 'index.html' como página de perfil temporal.
                window.location.href = 'index.html'; 
            } else {
                // Si está deslogueado, lo redirigimos a login.html
                if (authDropdown) authDropdown.classList.remove('active'); // Cerramos el dropdown
                window.location.href = 'login.html'; // ⬅️ REDIRECCIÓN A login.html
            }
        });
    }
    
    // 4. Lógica del Botón de Carrito (Abrir/Cerrar)
    if (cartIcon && closeCartBtn) {
        cartIcon.addEventListener('click', () => { window.toggleCart(); });
        closeCartBtn.addEventListener('click', () => { window.toggleCart(false); });

        // 5. Lógica del Botón de Checkout
        if (checkoutBtn) {
            checkoutBtn.addEventListener('click', () => {
                const cart = getCart();
                if (cart.length > 0) {
                    localStorage.setItem('transactionDetails', JSON.stringify(cart));
                    window.location.href = 'payment.html';
                }
            });
        }
    }
    
    // 6. Integración con el cambio de moneda
    window.addEventListener('currencyChanged', renderCart);
    
    // 7. Tareas de Inicialización al cargar el DOM
    renderCart();
    applySiteConfig();
    
    // 🚨 Inicializar Google Sign-In DESPUÉS de comprobar la sesión
    const isUserLoggedIn = checkUserSessionAndRenderUI(); 
    
    if (isUserLoggedIn) {
        // 🔑 CLAVE: Refrescar el saldo desde el servidor al iniciar la sesión/cargar la página
        // Esto asegura que si el saldo cambió en otra sesión, se actualice aquí.
        window.fetchWalletBalanceAndRefreshUserData(); 
    }
    
    if (!isUserLoggedIn) {
        // Lógica para asegurar que initGoogleSignIn se llame después de que el SDK cargue
        if (document.getElementById('google-login-btn')) {
            const checkGoogleLoad = setInterval(() => {
                if (typeof window.google !== 'undefined') {
                    clearInterval(checkGoogleLoad);
                    initGoogleSignIn();
                }
            }, 100);
        }
    }


    // =========================================================================
    // === MÓDULO: OCULTAR/MOSTRAR HEADER AL HACER SCROLL (SOLO MÓVIL) 📱 ===
    // =========================================================================
    const header = document.querySelector('header');
    if (header) { // Solo si el header existe
        let lastScrollTop = 0;
        // Ancho de pantalla MÁXIMO para activar el comportamiento (768px es el estándar de tablet/móvil)
        const mobileBreakpoint = 768; 
        // Mínimo de scroll que debe pasar antes de ocultar/mostrar (ajustable)
        const scrollThreshold = 50; 

        // 2. Define la función de manejo del scroll
        window.addEventListener('scroll', () => {
            const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
            
            // CLAVE: El comportamiento SÓLO se aplica si el ancho de la ventana es menor o igual al breakpoint.
            if (window.innerWidth <= mobileBreakpoint) {
                
                // Ocultar si hace scroll hacia abajo
                // Y si ha bajado más allá de la altura del header + el umbral (para evitar parpadeos al inicio)
                if (currentScroll > lastScrollTop && currentScroll > header.offsetHeight + scrollThreshold) {
                    header.classList.add('header-hide');
                } 
                // Mostrar si hace scroll hacia arriba
                else if (currentScroll < lastScrollTop) {
                    header.classList.remove('header-hide');
                }
                
                // Siempre mostrar si está muy cerca de la parte superior de la página
                if (currentScroll < scrollThreshold) {
                    header.classList.remove('header-hide');
                }
            } else {
                // En Desktop: Aseguramos que la clase 'header-hide' NUNCA esté activa.
                header.classList.remove('header-hide');
            }
            
            // 3. Actualiza la posición de scroll
            lastScrollTop = currentScroll <= 0 ? 0 : currentScroll; 
        }, { passive: true }); 
    }

});