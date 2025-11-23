// Конфигурация Supabase - ЗАМЕНИ НА СВОИ ДАННЫЕ!
const SUPABASE_URL = 'https://ntcschzvtnnvdkixcsho.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50Y3NjaHp2dG5udmRraXhjc2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4OTEzMDUsImV4cCI6MjA3OTQ2NzMwNX0.ejDPEx5bXDznE25mej9p0tmP1-c_wuOip2HHsWCXWBE';

class FridgeFriend {
    constructor() {
        this.supabase = null;
        this.currentUser = null;
        this.userProducts = [];
        this.init();
    }

    async init() {
        // Инициализируем Supabase
        this.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        
        this.setupEventListeners();
        this.loadProductOptions();
        this.setDefaultDates();
        await this.checkAuthStatus();
        await this.loadFromStorage();
        this.updateDisplay();
    }

    // 🔐 МЕТОДЫ АВТОРИЗАЦИИ
    async signup() {
        const email = document.getElementById('signupEmail').value.trim();
        const password = document.getElementById('signupPassword').value;
        const username = document.getElementById('signupUsername').value.trim();

        if (!email || !password || !username) {
            this.showMessage('Заполните все поля!', 'error');
            return;
        }

        if (password.length < 6) {
            this.showMessage('Пароль должен быть не менее 6 символов!', 'error');
            return;
        }

        try {
            // Регистрация в Supabase
            const { data, error } = await this.supabase.auth.signUp({
                email: email,
                password: password,
                options: {
                    data: {
                        username: username
                    }
                }
            });

            if (error) throw error;

            this.showMessage('✅ Регистрация успешна! Проверьте email для подтверждения.', 'success');
            change_to_login();
            
        } catch (error) {
            this.showMessage(`❌ Ошибка: ${error.message}`, 'error');
        }
    }

    async login() {
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;

        if (!email || !password) {
            this.showMessage('Заполните все поля!', 'error');
            return;
        }

        try {
            const { data, error } = await this.supabase.auth.signInWithPassword({
                email: email,
                password: password
            });

            if (error) throw error;

            this.currentUser = data.user;
            this.updateAuthUI();
            this.hideModal('authModal');
            
            // Мигрируем данные из localStorage в Supabase при первом входе
            await this.migrateLocalData();
            
            await this.loadFromStorage();
            this.updateDisplay();
            this.showMessage(`🎉 Добро пожаловать, ${data.user.user_metadata.username}!`, 'success');
            
        } catch (error) {
            this.showMessage(`❌ Ошибка входа: ${error.message}`, 'error');
        }
    }

    async migrateLocalData() {
        // Переносим данные из localStorage в Supabase при первом входе
        const localData = localStorage.getItem('fridgefriend_guest');
        if (localData) {
            try {
                const localProducts = JSON.parse(localData);
                if (localProducts.length > 0) {
                    this.userProducts = localProducts;
                    await this.saveToStorage();
                    localStorage.removeItem('fridgefriend_guest');
                    this.showMessage('📦 Ваши данные перенесены в облако!', 'success');
                }
            } catch (e) {
                console.error('Error migrating data:', e);
            }
        }
    }

    async logout() {
        if (confirm('Вы уверены, что хотите выйти?')) {
            const { error } = await this.supabase.auth.signOut();
            if (error) {
                this.showMessage('Ошибка при выходе', 'error');
                return;
            }
            
            this.currentUser = null;
            this.updateAuthUI();
            await this.loadFromStorage();
            this.updateDisplay();
            this.showMessage('👋 До свидания!', 'success');
        }
    }

    async checkAuthStatus() {
        try {
            const { data: { user } } = await this.supabase.auth.getUser();
            this.currentUser = user;
            this.updateAuthUI();
            
            if (user) {
                await this.loadFromStorage();
                this.updateDisplay();
            }
        } catch (error) {
            console.error('Auth check error:', error);
        }
    }

    updateAuthUI() {
        const authBtn = document.getElementById('authBtn');
        const userWelcome = document.getElementById('userWelcome');
        
        if (this.currentUser) {
            const username = this.currentUser.user_metadata?.username || this.currentUser.email;
            authBtn.textContent = '🚪 Выйти';
            userWelcome.textContent = `👋 Привет, ${username}`;
            userWelcome.style.display = 'block';
        } else {
            authBtn.textContent = '🔐 Войти';
            userWelcome.style.display = 'none';
        }
    }

    // 📦 МЕТОДЫ ДЛЯ РАБОТЫ С БАЗОЙ ДАННЫХ
    async loadFromStorage() {
        if (!this.currentUser) {
            // Для неавторизованных - локальное хранилище
            const saved = localStorage.getItem('fridgefriend_guest');
            this.userProducts = saved ? JSON.parse(saved) : [];
            if (this.userProducts.length === 0) {
                this.addSampleProducts();
            }
            return;
        }

        // Для авторизованных - загрузка из Supabase
        try {
            const { data, error } = await this.supabase
                .from('user_products')
                .select('*')
                .eq('user_id', this.currentUser.id)
                .order('created_at', { ascending: false });

            if (error) throw error;

            this.userProducts = data || [];
        } catch (error) {
            console.error('Error loading products:', error);
            this.userProducts = [];
        }
    }

    async saveToStorage() {
        if (!this.currentUser) {
            // Для гостей - локальное хранилище
            localStorage.setItem('fridgefriend_guest', JSON.stringify(this.userProducts));
            return;
        }

        // Для авторизованных - сохранение в Supabase
        try {
            // Удаляем все старые продукты пользователя
            const { error: deleteError } = await this.supabase
                .from('user_products')
                .delete()
                .eq('user_id', this.currentUser.id);

            if (deleteError) throw deleteError;

            // Добавляем новые продукты
            if (this.userProducts.length > 0) {
                const productsToSave = this.userProducts.map(product => ({
                    user_id: this.currentUser.id,
                    product_id: product.product_id,
                    product_name: product.product_name,
                    quantity: product.quantity,
                    unit: product.unit,
                    purchase_date: product.purchase_date,
                    expiry_date: product.expiry_date,
                    category: product.category
                }));

                const { error: insertError } = await this.supabase
                    .from('user_products')
                    .insert(productsToSave);

                if (insertError) throw insertError;
            }
        } catch (error) {
            console.error('Error saving products:', error);
            this.showMessage('Ошибка сохранения данных', 'error');
        }
    }

    async addProduct(e) {
        e.preventDefault();
        
        const productId = parseInt(document.getElementById('productName').value);
        const quantity = parseFloat(document.getElementById('quantity').value);
        const purchaseDate = document.getElementById('purchaseDate').value;
        const expiryDate = document.getElementById('expiryDate').value;

        if (!productId || !quantity) {
            this.showMessage('Заполните все поля!', 'error');
            return;
        }

        const product = this.getAvailableProducts().find(p => p.id === productId);
        
        const newProduct = {
            id: Date.now(), // Временный ID для локального использования
            product_id: productId,
            product_name: product.name,
            quantity: quantity,
            unit: product.unit,
            purchase_date: purchaseDate,
            expiry_date: expiryDate,
            category: product.category
        };

        this.userProducts.push(newProduct);
        await this.saveToStorage();
        
        this.hideModal('addProductModal');
        this.showMessage('✅ Продукт успешно добавлен!', 'success');
        this.updateDisplay();
        
        document.getElementById('addProductForm').reset();
        this.setDefaultDates();
    }

    async useProduct(productId) {
        if (confirm('Отметить продукт как использованный?')) {
            this.userProducts = this.userProducts.filter(p => p.id !== productId);
            await this.saveToStorage();
            this.showMessage('🍽️ Продукт использован!', 'success');
            this.updateDisplay();
        }
    }

    async clearData() {
        if (confirm('Очистить все данные? Это действие нельзя отменить.')) {
            this.userProducts = [];
            await this.saveToStorage();
            this.showMessage('🗑️ Все данные очищены!', 'success');
            this.updateDisplay();
        }
    }

    // 🔧 ОСТАЛЬНЫЕ МЕТОДЫ
    setupEventListeners() {
        document.getElementById('addProductBtn').addEventListener('click', () => this.showModal('addProductModal'));
        document.querySelectorAll('.close').forEach(closeBtn => {
            closeBtn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) {
                    this.hideModal(modal.id);
                }
            });
        });
        
        document.getElementById('addProductForm').addEventListener('submit', (e) => this.addProduct(e));
        
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.filterProducts(e.target.dataset.filter));
        });
        
        document.getElementById('viewRecipesBtn').addEventListener('click', () => this.showRecipes());
        document.getElementById('clearDataBtn').addEventListener('click', () => this.clearData());
        document.querySelector('.back-btn').addEventListener('click', () => this.showMainScreen());
        
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.hideModal('addProductModal');
                this.hideModal('authModal');
            }
        });

        document.getElementById('authBtn').addEventListener('click', () => this.showAuthModal());

        // Enter в форме
        document.getElementById('addProductForm').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.addProduct(e);
            }
        });
    }

    showAuthModal() {
        if (this.currentUser) {
            this.logout();
        } else {
            this.showModal('authModal');
        }
    }

    // 📋 МЕТОДЫ ДЛЯ ПРОДУКТОВ И РЕЦЕПТОВ
    getAvailableProducts() {
        return [
            { id: 1, name: 'Молоко', category: 'молочные', unit: 'л', shelf_life: 5 },
            { id: 2, name: 'Яйца', category: 'молочные', unit: 'шт', shelf_life: 21 },
            { id: 3, name: 'Помидоры', category: 'овощи', unit: 'кг', shelf_life: 7 },
            { id: 4, name: 'Огурцы', category: 'овощи', unit: 'кг', shelf_life: 5 },
            { id: 5, name: 'Куриная грудка', category: 'мясо', unit: 'кг', shelf_life: 3 },
            { id: 6, name: 'Рис', category: 'крупы', unit: 'кг', shelf_life: 365 },
            { id: 7, name: 'Лук', category: 'овощи', unit: 'кг', shelf_life: 30 },
            { id: 8, name: 'Морковь', category: 'овощи', unit: 'кг', shelf_life: 21 },
            { id: 9, name: 'Яблоки', category: 'фрукты', unit: 'кг', shelf_life: 14 },
            { id: 10, name: 'Сыр', category: 'молочные', unit: 'г', shelf_life: 10 },
            { id: 11, name: 'Хлеб', category: 'другое', unit: 'шт', shelf_life: 3 },
            { id: 12, name: 'Картофель', category: 'овощи', unit: 'кг', shelf_life: 60 }
        ];
    }

    getAvailableRecipes() {
        return [
            {
                id: 1,
                title: 'Омлет с овощами',
                description: 'Питательный завтрак со свежими овощами',
                cooking_time: 15,
                difficulty: 'легко',
                ingredients: [
                    { product_id: 2, quantity: 3, unit: 'шт' },
                    { product_id: 3, quantity: 2, unit: 'шт' },
                    { product_id: 7, quantity: 1, unit: 'шт' },
                    { product_id: 10, quantity: 50, unit: 'г' }
                ]
            },
            {
                id: 2,
                title: 'Курица с рисом',
                description: 'Вкусное и сытное основное блюдо',
                cooking_time: 30,
                difficulty: 'средне',
                ingredients: [
                    { product_id: 5, quantity: 0.5, unit: 'кг' },
                    { product_id: 6, quantity: 0.2, unit: 'кг' },
                    { product_id: 7, quantity: 1, unit: 'шт' },
                    { product_id: 8, quantity: 2, unit: 'шт' }
                ]
            },
            {
                id: 3,
                title: 'Овощной салат',
                description: 'Легкий и полезный салат',
                cooking_time: 10,
                difficulty: 'легко',
                ingredients: [
                    { product_id: 3, quantity: 3, unit: 'шт' },
                    { product_id: 4, quantity: 2, unit: 'шт' },
                    { product_id: 7, quantity: 0.5, unit: 'шт' }
                ]
            },
            {
                id: 4,
                title: 'Картофельное пюре',
                description: 'Нежное картофельное пюре',
                cooking_time: 25,
                difficulty: 'легко',
                ingredients: [
                    { product_id: 12, quantity: 1, unit: 'кг' },
                    { product_id: 1, quantity: 0.2, unit: 'л' }
                ]
            }
        ];
    }

    loadProductOptions() {
        const select = document.getElementById('productName');
        select.innerHTML = '<option value="">Выберите продукт</option>';
        
        this.getAvailableProducts().forEach(product => {
            const option = document.createElement('option');
            option.value = product.id;
            option.textContent = `${product.name} (${product.unit})`;
            option.dataset.unit = product.unit;
            select.appendChild(option);
        });

        select.addEventListener('change', (e) => {
            const selectedOption = e.target.options[e.target.selectedIndex];
            const unit = selectedOption.dataset.unit;
            if (unit === 'шт') {
                document.getElementById('quantity').step = '1';
                document.getElementById('quantity').value = '1';
            } else {
                document.getElementById('quantity').step = '0.1';
                document.getElementById('quantity').value = '0.5';
            }
        });
    }

    setDefaultDates() {
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('purchaseDate').value = today;
        
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 3);
        document.getElementById('expiryDate').value = expiryDate.toISOString().split('T')[0];
    }

    addSampleProducts() {
        const today = new Date();
        const sampleProducts = [
            {
                id: Date.now() + 1,
                product_id: 1,
                product_name: 'Молоко',
                quantity: 1,
                unit: 'л',
                purchase_date: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                expiry_date: new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                category: 'молочные'
            },
            {
                id: Date.now() + 2,
                product_id: 2,
                product_name: 'Яйца',
                quantity: 6,
                unit: 'шт',
                purchase_date: today.toISOString().split('T')[0],
                expiry_date: new Date(today.getTime() + 18 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                category: 'молочные'
            },
            {
                id: Date.now() + 3,
                product_id: 6,
                product_name: 'Рис',
                quantity: 2,
                unit: 'кг',
                purchase_date: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                expiry_date: new Date(today.getTime() + 300 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                category: 'крупы'
            }
        ];

        this.userProducts.push(...sampleProducts);
        this.saveToStorage();
    }

    filterProducts(filter) {
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');
        this.updateDisplay(filter);
    }

    updateDisplay(filter = 'all') {
        this.displayProducts(filter);
        this.updateStats();
    }

    displayProducts(filter = 'all') {
        const container = document.getElementById('productsList');
        
        if (this.userProducts.length === 0) {
            container.innerHTML = `
                <div class="no-products">
                    <h3>🥺 Холодильник пуст</h3>
                    <p>Добавьте продукты, чтобы начать отслеживание</p>
                    <button onclick="fridgeFriend.showModal('addProductModal')" class="btn-primary">
                        ➕ Добавить первый продукт
                    </button>
                </div>
            `;
            return;
        }

        const filteredProducts = this.filterProductsList(this.userProducts, filter);
        
        if (filteredProducts.length === 0) {
            container.innerHTML = '<p class="no-products">Нет продуктов по выбранному фильтру</p>';
            return;
        }

        container.innerHTML = filteredProducts.map(product => {
            const isExpiring = this.isProductExpiring(product.expiry_date);
            const daysLeft = this.getDaysUntilExpiry(product.expiry_date);
            
            return `
                <div class="product-card ${isExpiring ? 'expiring' : 'fresh'}">
                    <div class="product-header">
                        <span class="product-name">${product.product_name}</span>
                        <span class="product-quantity">${product.quantity} ${product.unit}</span>
                    </div>
                    <div class="product-expiry">
                        📅 Куплен: ${this.formatDate(product.purchase_date)}
                    </div>
                    <div class="product-expiry ${isExpiring ? 'expiring-text' : ''}">
                        ⏰ Годен до: ${this.formatDate(product.expiry_date)} 
                        (${daysLeft} ${this.getDayText(daysLeft)})
                        ${isExpiring ? ' ⚠️ СКОРО ИСПОРТИТСЯ!' : ''}
                    </div>
                    <div class="product-actions">
                        <button onclick="fridgeFriend.useProduct(${product.id})" class="btn-secondary">
                            🍽️ Использовать
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    filterProductsList(products, filter) {
        const today = new Date();
        const threeDaysLater = new Date();
        threeDaysLater.setDate(today.getDate() + 3);

        switch (filter) {
            case 'expiring':
                return products.filter(product => 
                    new Date(product.expiry_date) <= threeDaysLater
                );
            case 'fresh':
                return products.filter(product => 
                    new Date(product.expiry_date) > threeDaysLater
                );
            default:
                return products;
        }
    }

    updateStats() {
        const today = new Date();
        const threeDaysLater = new Date();
        threeDaysLater.setDate(today.getDate() + 3);

        const expiringCount = this.userProducts.filter(product => 
            new Date(product.expiry_date) <= threeDaysLater
        ).length;

        const availableRecipes = this.findAvailableRecipes().length;

        document.getElementById('productCount').textContent = this.userProducts.length;
        document.getElementById('expiringCount').textContent = expiringCount;
        document.getElementById('recipesCount').textContent = availableRecipes;
    }

    showRecipes() {
        const availableRecipes = this.findAvailableRecipes();
        this.displayRecipes(availableRecipes);
        this.showScreen('recipesScreen');
    }

    findAvailableRecipes() {
        const availableProductIds = this.userProducts.map(p => p.product_id);
        
        return this.getAvailableRecipes().filter(recipe => {
            const missingIngredients = recipe.ingredients.filter(ingredient => 
                !availableProductIds.includes(ingredient.product_id)
            );
            return missingIngredients.length === 0;
        });
    }

    displayRecipes(recipes) {
        const container = document.getElementById('recipesList');
        
        if (recipes.length === 0) {
            container.innerHTML = `
                <div class="no-products">
                    <h3>😔 Нет доступных рецептов</h3>
                    <p>Добавьте больше продуктов в холодильник</p>
                </div>
            `;
            return;
        }

        container.innerHTML = recipes.map(recipe => {
            const availableProducts = this.getAvailableProducts();
            
            return `
                <div class="recipe-card">
                    <h4>${recipe.title}</h4>
                    <p style="color: #7f8c8d; margin-bottom: 15px;">${recipe.description}</p>
                    <div class="recipe-meta">
                        <span>⏱️ ${recipe.cooking_time} мин</span>
                        <span>📊 ${recipe.difficulty}</span>
                        <span>🍽️ ${recipe.ingredients.length} ингредиентов</span>
                    </div>
                    <h5>🛒 Ингредиенты:</h5>
                    <ul class="ingredients-list">
                        ${recipe.ingredients.map(ing => {
                            const product = availableProducts.find(p => p.id === ing.product_id);
                            const userProduct = this.userProducts.find(p => p.product_id === ing.product_id);
                            return `
                                <li>
                                    <span>${product.name}</span>
                                    <span>${ing.quantity} ${ing.unit} 
                                    ${userProduct ? `(есть: ${userProduct.quantity} ${userProduct.unit})` : ''}
                                    </span>
                                </li>
                            `;
                        }).join('')}
                    </ul>
                    <button onclick="fridgeFriend.cookRecipe(${recipe.id})" class="btn-primary">
                        🍳 Приготовить это блюдо
                    </button>
                </div>
            `;
        }).join('');
    }

    cookRecipe(recipeId) {
        const recipe = this.getAvailableRecipes().find(r => r.id === recipeId);
        if (confirm(`Приготовить "${recipe.title}"? Продукты будут отмечены как использованные.`)) {
            recipe.ingredients.forEach(ingredient => {
                const productIndex = this.userProducts.findIndex(p => p.product_id === ingredient.product_id);
                if (productIndex !== -1) {
                    this.userProducts.splice(productIndex, 1);
                }
            });
            
            this.saveToStorage();
            this.showMessage(`🎉 "${recipe.title}" приготовлен! Продукты использованы.`, 'success');
            this.updateDisplay();
            this.showMainScreen();
        }
    }

    // 🎯 ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
    showModal(modalId) {
        document.getElementById(modalId).style.display = 'block';
    }

    hideModal(modalId) {
        document.getElementById(modalId).style.display = 'none';
    }

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
    }

    showMainScreen() {
        this.showScreen('mainScreen');
    }

    showMessage(message, type) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#2ecc71' : '#e74c3c'};
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    isProductExpiring(expiryDate) {
        const today = new Date();
        const threeDaysLater = new Date();
        threeDaysLater.setDate(today.getDate() + 3);
        return new Date(expiryDate) <= threeDaysLater;
    }

    getDaysUntilExpiry(expiryDate) {
        const today = new Date();
        const expiry = new Date(expiryDate);
        const diffTime = expiry - today;
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    getDayText(days) {
        if (days === 1) return 'день';
        if (days >= 2 && days <= 4) return 'дня';
        return 'дней';
    }

    formatDate(dateString) {
        return new Date(dateString).toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }
}

// Функции для работы с окном авторизации
function change_to_login() {
    document.querySelector('.cont_forms').className = "cont_forms cont_forms_active_login";  
    document.querySelector('.cont_form_login').style.display = "block";
    document.querySelector('.cont_form_sign_up').style.opacity = "0";               

    setTimeout(function(){  
        document.querySelector('.cont_form_login').style.opacity = "1"; 
    }, 400);  
    
    setTimeout(function(){    
        document.querySelector('.cont_form_sign_up').style.display = "none";
    }, 200);  
}

function change_to_sign_up() {
    document.querySelector('.cont_forms').className = "cont_forms cont_forms_active_sign_up";
    document.querySelector('.cont_form_sign_up').style.display = "block";
    document.querySelector('.cont_form_login').style.opacity = "0";
    
    setTimeout(function(){  
        document.querySelector('.cont_form_sign_up').style.opacity = "1";
    }, 100);  

    setTimeout(function(){   
        document.querySelector('.cont_form_login').style.display = "none";
    }, 400);  
}

function hidden_login_and_sign_up() {
    document.querySelector('.cont_forms').className = "cont_forms";  
    document.querySelector('.cont_form_sign_up').style.opacity = "0";               
    document.querySelector('.cont_form_login').style.opacity = "0"; 

    setTimeout(function(){
        document.querySelector('.cont_form_sign_up').style.display = "none";
        document.querySelector('.cont_form_login').style.display = "none";
    }, 500);  
}

function login() {
    window.fridgeFriend.login();
}

function signup() {
    window.fridgeFriend.signup();
}

// Добавляем CSS для анимаций
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
    }
    
    .product-card, .recipe-card, .stats-card {
        animation: fadeIn 0.5s ease;
    }
`;
document.head.appendChild(style);

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    window.fridgeFriend = new FridgeFriend();
});