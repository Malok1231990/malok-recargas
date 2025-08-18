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
        localStorage.setItem('selectedCurrency', value);
        window.dispatchEvent(new CustomEvent('currencyChanged', { detail: { currency: value } }));
    }

    // Inicializar el selector con la moneda guardada o por defecto
    const savedCurrency = localStorage.getItem('selectedCurrency') || 'VES';
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

    // ---- Lógica de la barra de búsqueda (filtrado en la misma página) ----
    const searchInput = document.querySelector('.search-bar input');
    const gameGrid = document.getElementById('game-grid');
    const gameCards = gameGrid ? gameGrid.querySelectorAll('.game-card') : [];

    if (searchInput) {
        searchInput.addEventListener('input', () => { 
            const searchTerm = searchInput.value.toLowerCase();

            if (gameGrid) {
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

    // ---- Lógica Específica para cada Página de Recarga (Free Fire, Roblox, Netflix) ----
    const pageName = window.location.pathname.split('/').pop();
    const currencyDisplaySpan = document.getElementById('currency-display');
    const packageListDiv = document.getElementById('package-list');
    const confirmBtn = document.getElementById('confirm-recharge-btn');

    let selectedPackage = null;
    let packagesData;
    let formElement;
    
    // Define los paquetes para cada servicio
    switch (pageName) {
        case 'freefire.html':
            packagesData = [
                { id: 1, name: '100+10 Diamantes', priceUSD: 0.80, priceVES: 185.00 },
                { id: 2, name: '310+31 Diamantes', priceUSD: 2.40, priceVES: 530.00 },
                { id: 3, name: '520+52 Diamantes', priceUSD: 3.90, priceVES: 900.00 },
                { id: 4, name: '1050+105 Diamantes', priceUSD: 7.90, priceVES: 1795.00 },
                { id: 5, name: '2180+218 Diamantes', priceUSD: 14.50, priceVES: 3475.00 },
                { id: 6, name: '5600+560 Diamantes', priceUSD: 37.00, priceVES: 7600.00 },
                { id: 7, name: 'Tarjeta Semanal', priceUSD: 1.80, priceVES: 430.00 },
                { id: 8, name: 'Tarjeta Mensual', priceUSD: 7.90, priceVES: 1765.00 }
            ];
            formElement = document.getElementById('freefire-recharge-form');
            break;
        case 'roblox.html':
            packagesData = [
                { id: 1, name: '400 Robux', priceUSD: 4.99, priceVES: 175.00 },
                { id: 2, name: '800 Robux', priceUSD: 9.99, priceVES: 350.00 },
                { id: 3, name: '1700 Robux', priceUSD: 19.99, priceVES: 700.00 },
                { id: 4, name: '4500 Robux', priceUSD: 49.99, priceVES: 1750.00 },
                { id: 5, name: '10000 Robux', priceUSD: 99.99, priceVES: 3500.00 }
            ];
            formElement = document.getElementById('roblox-recharge-form');
            break;
        case 'netflix.html':
            packagesData = [
                { id: 1, name: 'Cuenta Netflix 1 mes', priceUSD: 5.50, priceVES: 130.00 },
                { id: 2, name: 'Cuenta Netflix 3 meses', priceUSD: 14.00, priceVES: 330.00 },
                { id: 3, name: 'Cuenta Netflix 6 meses', priceUSD: 25.00, priceVES: 580.00 },
                { id: 4, name: 'Cuenta Netflix 1 año', priceUSD: 45.00, priceVES: 1050.00 }
            ];
            formElement = document.getElementById('netflix-recharge-form');
            break;
        default:
            return;
    }
    
    // Funciones comunes para las páginas de recarga
    function formatPrice(price, currency) {
        if (currency === 'VES') {
            return `Bs. ${price.toFixed(2)}`;
        } else {
            return `$${price.toFixed(2)}`;
        }
    }

    function updatePackages(currentCurrency) {
        if (!packageListDiv || !packagesData) return;
        
        currencyDisplaySpan.textContent = currentCurrency;
        packageListDiv.innerHTML = '';
        packagesData.forEach(pkg => {
            let displayPrice = (currentCurrency === 'VES') ? pkg.priceVES : pkg.priceUSD;
            const packageItem = document.createElement('div');
            packageItem.classList.add('package-item');
            packageItem.dataset.id = pkg.id;
            packageItem.dataset.priceUsd = pkg.priceUSD;
            packageItem.dataset.priceVes = pkg.priceVES;
            packageItem.innerHTML = `
                <span>${pkg.name}</span>
                <span class="price">${formatPrice(displayPrice, currentCurrency)}</span>
            `;
            packageItem.addEventListener('click', () => {
                if (selectedPackage) {
                    selectedPackage.classList.remove('selected');
                }
                packageItem.classList.add('selected');
                selectedPackage = packageItem;
                checkFormValidity();
            });
            packageListDiv.appendChild(packageItem);
        });
        checkFormValidity();
    }

    function checkFormValidity() {
        if (!confirmBtn) return;

        let isFormValid = false;
        const isPackageSelected = !!selectedPackage;
        
        if (pageName === 'freefire.html') {
            const playerIdInput = document.getElementById('player-id');
            const playerIdValid = playerIdInput && playerIdInput.value.trim() !== '';
            isFormValid = playerIdValid && isPackageSelected;
        } else if (pageName === 'roblox.html') {
            const emailInput = document.getElementById('roblox-email');
            const passwordInput = document.getElementById('roblox-password');
            const emailValid = emailInput && emailInput.value.trim() !== '';
            const passwordValid = passwordInput && passwordInput.value.trim() !== '';
            isFormValid = emailValid && passwordValid && isPackageSelected;
        } else if (pageName === 'netflix.html') {
            isFormValid = isPackageSelected;
        }

        confirmBtn.disabled = !isFormValid;
    }

    const initialCurrency = localStorage.getItem('selectedCurrency') || 'VES';
    updatePackages(initialCurrency);
    
    window.addEventListener('currencyChanged', (event) => {
        const newCurrency = event.detail.currency;
        updatePackages(newCurrency);
    });

    if (pageName === 'freefire.html') {
        const playerIdInput = document.getElementById('player-id');
        if(playerIdInput) playerIdInput.addEventListener('input', checkFormValidity);
    } else if (pageName === 'roblox.html') {
        const emailInput = document.getElementById('roblox-email');
        const passwordInput = document.getElementById('roblox-password');
        if(emailInput) emailInput.addEventListener('input', checkFormValidity);
        if(passwordInput) passwordInput.addEventListener('input', checkFormValidity);
    }

    if (formElement) {
        formElement.addEventListener('submit', (e) => {
            e.preventDefault();
            if (selectedPackage) {
                const packageName = selectedPackage.querySelector('span:first-child').textContent;
                const basePriceUSD = parseFloat(selectedPackage.dataset.priceUsd);
                const basePriceVES = parseFloat(selectedPackage.dataset.priceVes);
                const selectedCurrency = localStorage.getItem('selectedCurrency') || 'VES';
                const finalPrice = (selectedCurrency === 'VES') ? basePriceVES : basePriceUSD;
                
                const transactionDetails = {
                    game: formElement.id.replace('-recharge-form', ''),
                    package: packageName,
                    priceUSD: basePriceUSD.toFixed(2),
                    finalPrice: finalPrice.toFixed(2),
                    currency: selectedCurrency
                };

                if (pageName === 'freefire.html') {
                    transactionDetails.playerId = document.getElementById('player-id').value.trim();
                } else if (pageName === 'roblox.html') {
                    transactionDetails.robloxEmail = document.getElementById('roblox-email').value.trim();
                    transactionDetails.robloxPassword = document.getElementById('roblox-password').value.trim();
                }
                
                localStorage.setItem('transactionDetails', JSON.stringify(transactionDetails));
                window.location.href = 'payment.html';
            } else {
                console.error('Por favor, selecciona un plan de recarga.');
            }
        });
    }
});
