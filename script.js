class FridgeFriend {
    constructor() {
        this.currentUser = null;
        this.userProducts = [];
        this.availableProducts = [];
        this.availableRecipes = [];
        this.init();
    }

    async init() {
        await this.loadProductsAndRecipes();
        this.setupEventListeners();
        this.loadProductOptions();
        this.setDefaultDates();
        this.setupAuthListener();
        await this.loadFromStorage();
        this.updateDisplay();
    }

    // 🔐 СЛУШАЕМ ИЗМЕНЕНИЯ АВТОРИЗАЦИИ
    setupAuthListener() {
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                // Пользователь вошел
                this.currentUser = {
                    id: user.uid,
                    email: user.email,
                    username: user.displayName || user.email.split('@')[0]
                };
                this.updateAuthUI();
                await this.migrateLocalData();
                await this.loadFromStorage();
                this.updateDisplay();
                console.log('Пользователь вошел:', this.currentUser);
            } else {
                // Пользователь вышел
                this.currentUser = null;
                this.updateAuthUI();
                await this.loadFromStorage();
                this.updateDisplay();
                console.log('Пользователь вышел');
            }
        });
    }

    // 🔐 РЕГИСТРАЦИЯ
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
            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            await userCredential.user.updateProfile({
                displayName: username
            });
            
            // Создаем запись пользователя в Firestore
            await db.collection('users').doc(userCredential.user.uid).set({
                username: username,
                email: email,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            this.showMessage('✅ Регистрация успешна!', 'success');
            change_to_login();
            
        } catch (error) {
            this.showMessage(`❌ Ошибка: ${error.message}`, 'error');
        }
    }

    // 🔐 ВХОД
    async login() {
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;

        if (!email || !password) {
            this.showMessage('Заполните все поля!', 'error');
            return;
        }

        try {
            await auth.signInWithEmailAndPassword(email, password);
            this.hideModal('authModal');
            this.showMessage('🎉 Добро пожаловать!', 'success');
            
        } catch (error) {
            this.showMessage(`❌ Ошибка входа: ${error.message}`, 'error');
        }
    }

    // 🔐 ВЫХОД
    async logout() {
        if (confirm('Вы уверены, что хотите выйти?')) {
            try {
                await auth.signOut();
                this.showMessage('👋 До свидания!', 'success');
            } catch (error) {
                this.showMessage('Ошибка при выходе', 'error');
            }
        }
    }

    updateAuthUI() {
        const authBtn = document.getElementById('authBtn');
        const userWelcome = document.getElementById('userWelcome');
        
        if (this.currentUser) {
            authBtn.textContent = '🚪 Выйти';
            userWelcome.textContent = `👋 Привет, ${this.currentUser.username}`;
            userWelcome.style.display = 'block';
        } else {
            authBtn.textContent = '🔐 Войти';
            userWelcome.style.display = 'none';
        }
    }

    // 📦 ЗАГРУЗКА ПРОДУКТОВ И РЕЦЕПТОВ ИЗ FIREBASE
    async loadProductsAndRecipes() {
        try {
            // Загружаем продукты
            const productsSnapshot = await db.collection('products').get();
            this.availableProducts = productsSnapshot.docs.map(doc => ({
                id: Number(doc.id) || doc.id,
                ...doc.data()
            }));

            // Загружаем рецепты
            const recipesSnapshot = await db.collection('recipes').get();
            this.availableRecipes = recipesSnapshot.docs.map(doc => ({
                id: Number(doc.id) || doc.id,
                ...doc.data()
            }));

            console.log('Загружено продуктов:', this.availableProducts.length);
            console.log('Загружено рецептов:', this.availableRecipes.length);

        } catch (error) {
            console.error('Error loading catalog:', error);
            this.showMessage('Ошибка загрузки каталога', 'error');
            this.availableProducts = this.getLocalProducts();
            this.availableRecipes = this.getLocalRecipes();
        }
    }

    // 📦 ЗАГРУЗКА ПРОДУКТОВ ПОЛЬЗОВАТЕЛЯ
    async loadFromStorage() {
        if (!this.currentUser) {
            // Гостевой режим
            const saved = localStorage.getItem('fridgefriend_guest');
            this.userProducts = saved ? JSON.parse(saved) : [];
            if (this.userProducts.length === 0) {
                this.addSampleProducts();
            }
            console.log('Гостевой режим, продуктов:', this.userProducts.length);
            return;
        }

        try {
            const snapshot = await db.collection('userProducts')
                .where('userId', '==', this.currentUser.id)
                .orderBy('createdAt', 'desc')
                .get();

            this.userProducts = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: data.localId || doc.id, // Используем сохраненный localId или document id
                    firestoreId: doc.id, // Сохраняем Firebase ID для будущих операций
                    product_id: data.productId,
                    product_name: data.productName,
                    quantity: data.quantity,
                    unit: data.unit,
                    purchase_date: data.purchaseDate,
                    expiry_date: data.expiryDate,
                    category: data.category
                };
            });

            console.log('Загружено продуктов из Firebase:', this.userProducts.length);

            // Сохраняем локальную копию
            localStorage.setItem(`fridgefriend_${this.currentUser.id}`, JSON.stringify(this.userProducts));

        } catch (error) {
            console.error('Error loading products:', error);
            const cached = localStorage.getItem(`fridgefriend_${this.currentUser.id}`);
            this.userProducts = cached ? JSON.parse(cached) : [];
            console.log('Загружено из кэша:', this.userProducts.length);
        }
    }

    // 📦 СОХРАНЕНИЕ ПРОДУКТОВ
    async saveToStorage() {
        if (!this.currentUser) {
            localStorage.setItem('fridgefriend_guest', JSON.stringify(this.userProducts));
            console.log('Сохранено в гостевом режиме:', this.userProducts.length);
            return;
        }

        try {
            // Получаем все текущие продукты пользователя из Firebase
            const snapshot = await db.collection('userProducts')
                .where('userId', '==', this.currentUser.id)
                .get();
            
            // Создаем Map существующих продуктов по их локальному ID
            const existingProducts = new Map();
            snapshot.docs.forEach(doc => {
                const data = doc.data();
                // Сохраняем связь между локальным ID и Firebase document ID
                if (data.localId) {
                    existingProducts.set(data.localId, {
                        firestoreId: doc.id,
                        data: data
                    });
                }
            });

            console.log('Найдено существующих продуктов в Firebase:', existingProducts.size);

            // Создаем batch для операций
            const batch = db.batch();

            // Обрабатываем каждый продукт из текущего списка
            this.userProducts.forEach(product => {
                const existing = existingProducts.get(product.id);
                
                if (existing) {
                    // Продукт уже есть в Firebase - обновляем его
                    console.log('Обновление продукта:', product.id);
                    const docRef = db.collection('userProducts').doc(existing.firestoreId);
                    batch.update(docRef, {
                        productId: product.product_id,
                        productName: product.product_name,
                        quantity: product.quantity,
                        unit: product.unit,
                        purchaseDate: product.purchase_date,
                        expiryDate: product.expiry_date,
                        category: product.category,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    // Удаляем из Map обработанный продукт
                    existingProducts.delete(product.id);
                } else {
                    // Новый продукт - создаем документ
                    console.log('Создание нового продукта:', product.id);
                    const newDocRef = db.collection('userProducts').doc();
                    batch.set(newDocRef, {
                        userId: this.currentUser.id,
                        localId: product.id, // СОХРАНЯЕМ ЛОКАЛЬНЫЙ ID
                        productId: product.product_id,
                        productName: product.product_name,
                        quantity: product.quantity,
                        unit: product.unit,
                        purchaseDate: product.purchase_date,
                        expiryDate: product.expiry_date,
                        category: product.category,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                }
            });

            // Удаляем продукты, которых нет в текущем списке
            existingProducts.forEach((value, localId) => {
                console.log('Удаление продукта:', localId);
                const docRef = db.collection('userProducts').doc(value.firestoreId);
                batch.delete(docRef);
            });

            await batch.commit();
            console.log('Batch операция выполнена успешно');
            
            // Обновляем локальную копию
            localStorage.setItem(`fridgefriend_${this.currentUser.id}`, JSON.stringify(this.userProducts));
            this.showMessage('💾 Данные сохранены в облаке', 'success');

        } catch (error) {
            console.error('Error saving products:', error);
            localStorage.setItem(`fridgefriend_${this.currentUser.id}`, JSON.stringify(this.userProducts));
            this.showMessage('Данные сохранены локально', 'info');
        }
    }

    // 🔍 МЕТОД ДЛЯ ОТЛАДКИ
    async checkFirebaseData() {
        if (!this.currentUser) {
            console.log('Нет авторизованного пользователя');
            return;
        }
        
        try {
            const snapshot = await db.collection('userProducts')
                .where('userId', '==', this.currentUser.id)
                .get();
            
            console.log('=== ДАННЫЕ В FIREBASE ===');
            console.log('Всего документов:', snapshot.docs.length);
            snapshot.docs.forEach(doc => {
                console.log('Document ID:', doc.id);
                console.log('Data:', doc.data());
            });
            console.log('=========================');
            
            console.log('=== ЛОКАЛЬНЫЕ ДАННЫЕ ===');
            console.log('Продукты:', this.userProducts);
            console.log('=========================');
            
        } catch (error) {
            console.error('Ошибка проверки Firebase:', error);
        }
    }

    async migrateLocalData() {
        const localData = localStorage.getItem('fridgefriend_guest');
        if (localData && this.currentUser) {
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

    // 📋 ЛОКАЛЬНЫЕ ДАННЫЕ (НА СЛУЧАЙ ОШИБКИ)
    getLocalProducts() {
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

    getLocalRecipes() {
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

    getAvailableProducts() {
        return this.availableProducts.length > 0 ? this.availableProducts : this.getLocalProducts();
    }

    getAvailableRecipes() {
        return this.availableRecipes.length > 0 ? this.availableRecipes : this.getLocalRecipes();
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
            id: Date.now(),
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
            // Удаляем из локального массива
            this.userProducts = this.userProducts.filter(p => p.id !== productId);
            // Сохраняем изменения в Firebase
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
                        <button onclick="fridgeFriend.useProduct('${product.id}')" class="btn-secondary">
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
        // Создаем контейнер для уведомлений если его нет
        let notificationContainer = document.getElementById('notification-container');
        if (!notificationContainer) {
            notificationContainer = document.createElement('div');
            notificationContainer.id = 'notification-container';
            notificationContainer.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                gap: 10px;
                max-width: 350px;
            `;
            document.body.appendChild(notificationContainer);
        }

        // Создаем уведомление
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <span class="notification-message">${message}</span>
                <button class="notification-close" onclick="this.parentElement.parentElement.remove(); window.fridgeFriend.recalculateNotifications()">×</button>
            </div>
        `;
        
        notificationContainer.appendChild(notification);
        this.recalculateNotifications();
        
        // Автоматическое удаление через 4 секунды
        setTimeout(() => {
            if (notification.parentNode) {
                notification.classList.add('fade-out');
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                        this.recalculateNotifications();
                    }
                }, 300);
            }
        }, 4000);
    }

    recalculateNotifications() {
        const notificationContainer = document.getElementById('notification-container');
        if (!notificationContainer) return;
        
        const notifications = notificationContainer.querySelectorAll('.notification');
        let currentTop = 20;
        
        notifications.forEach((notif) => {
            notif.style.transform = `translateY(${currentTop}px)`;
            currentTop += notif.offsetHeight + 10;
        });
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

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    window.fridgeFriend = new FridgeFriend();
});
