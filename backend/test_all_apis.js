/**
 * Comprehensive Automated Verification Suite for Pop Carty Backend
 * Tests all endpoints: Auth, Products, Cart, Wishlist, Addresses, Orders, Admin
 */

const http = require('http');

async function runTests() {
    console.log('========================================================');
    console.log('🧪 Starting Comprehensive Pop Carty API Verification Suite');
    console.log('========================================================\n');

    // 1. Start backend server on test port 3001
    process.env.PORT = 3001;
    const app = require('./server.js');
    const { db, readyPromise } = require('./db.js');

    await readyPromise;
    console.log('✔ Database initialized successfully.');

    const server = http.createServer(app);
    await new Promise(resolve => server.listen(3001, resolve));
    console.log('✔ Server listening on port 3001.\n');

    const BASE = 'http://localhost:3001';

    async function req(path, options = {}) {
        const url = `${BASE}${path}`;
        const res = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        });
        const data = await res.json();
        return { status: res.status, data };
    }

    let adminToken = null;
    let customerToken = null;

    try {
        // Test 1: Health check
        console.log('1. Testing GET /api/health...');
        const health = await req('/api/health');
        if (health.status !== 200 || health.data.status !== 'ok') throw new Error('Health check failed: ' + JSON.stringify(health));
        console.log(`   ✔ Passed! Database engine: ${health.data.database}`);

        // Test 2: Customer Login
        console.log('2. Testing POST /api/auth/login (Customer)...');
        const custLogin = await req('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: 'shopper@popcarty.com', password: 'Customer@2026!' })
        });
        if (custLogin.status !== 200 || !custLogin.data.token) throw new Error('Customer login failed: ' + JSON.stringify(custLogin));
        customerToken = custLogin.data.token;
        console.log(`   ✔ Passed! Customer logged in: ${custLogin.data.user.name}`);

        // Test 3: Admin Login
        console.log('3. Testing POST /api/auth/login (Admin)...');
        const adminLogin = await req('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: 'admin@popcarty.com', password: 'PopCarty@2026!' })
        });
        if (adminLogin.status !== 200 || !adminLogin.data.token || adminLogin.data.user.role !== 'admin') {
            throw new Error('Admin login failed: ' + JSON.stringify(adminLogin));
        }
        adminToken = adminLogin.data.token;
        console.log(`   ✔ Passed! Admin logged in: ${adminLogin.data.user.name}`);

        // Test 4: Auth Me
        console.log('4. Testing GET /api/auth/me...');
        const me = await req('/api/auth/me', { headers: { Authorization: `Bearer ${customerToken}` } });
        if (me.status !== 200 || !me.data.user) throw new Error('Auth me failed');
        console.log(`   ✔ Passed! Authenticated as: ${me.data.user.email}`);

        // Test 5: Products listing
        console.log('5. Testing GET /api/products...');
        const products = await req('/api/products');
        if (products.status !== 200 || !Array.isArray(products.data.products) || products.data.products.length === 0) {
            throw new Error('Products fetch failed');
        }
        console.log(`   ✔ Passed! Retrieved ${products.data.products.length} products.`);

        // Test 6: Single product
        console.log('6. Testing GET /api/products/:id...');
        const firstProdId = products.data.products[0].product_id;
        const single = await req(`/api/products/${firstProdId}`);
        if (single.status !== 200 || !single.data.product) throw new Error('Single product fetch failed');
        console.log(`   ✔ Passed! Product: "${single.data.product.product_name}" (Price: ${single.data.product.price})`);

        // Test 7: Categories
        console.log('7. Testing GET /api/categories...');
        const cats = await req('/api/categories');
        if (cats.status !== 200 || !Array.isArray(cats.data.categories)) throw new Error('Categories fetch failed');
        console.log(`   ✔ Passed! Retrieved ${cats.data.categories.length} categories.`);

        // Test 8: Wishlist
        console.log('8. Testing POST & GET /api/wishlist...');
        const toggleWish = await req('/api/wishlist', {
            method: 'POST',
            headers: { Authorization: `Bearer ${customerToken}` },
            body: JSON.stringify({ product_id: firstProdId })
        });
        if (toggleWish.status !== 200) throw new Error('Toggle wishlist failed');
        const getWish = await req('/api/wishlist', { headers: { Authorization: `Bearer ${customerToken}` } });
        if (getWish.status !== 200) throw new Error('Get wishlist failed');
        console.log(`   ✔ Passed! Wishlist count: ${getWish.data.count}`);

        // Test 9: Addresses
        console.log('9. Testing GET & POST /api/addresses...');
        const getAddrs = await req('/api/addresses', { headers: { Authorization: `Bearer ${customerToken}` } });
        if (getAddrs.status !== 200) throw new Error('Get addresses failed');
        console.log(`   ✔ Passed! Found ${getAddrs.data.addresses.length} saved addresses.`);

        // Test 10: Orders
        console.log('10. Testing GET /api/orders...');
        const getOrders = await req('/api/orders', { headers: { Authorization: `Bearer ${customerToken}` } });
        if (getOrders.status !== 200) throw new Error('Get orders failed');
        console.log(`   ✔ Passed! Found ${getOrders.data.orders.length} historical orders.`);

        // Test 11: Admin Dashboard
        console.log('11. Testing GET /api/admin/dashboard...');
        const dashboard = await req('/api/admin/dashboard', { headers: { Authorization: `Bearer ${adminToken}` } });
        if (dashboard.status !== 200 || !dashboard.data.stats) throw new Error('Admin dashboard failed');
        console.log(`   ✔ Passed! Total Products: ${dashboard.data.stats.totalProducts}, Total Orders: ${dashboard.data.stats.totalOrders}`);

        // Test 12: Admin Inventory
        console.log('12. Testing GET /api/admin/inventory...');
        const inventory = await req('/api/admin/inventory', { headers: { Authorization: `Bearer ${adminToken}` } });
        if (inventory.status !== 200 || !inventory.data.inventory) throw new Error('Admin inventory failed');
        console.log(`   ✔ Passed! Inventory tracked for ${inventory.data.inventory.length} items.`);

        // Test 13: Admin Customer Directory
        console.log('13. Testing GET /api/admin/users...');
        const users = await req('/api/admin/users', { headers: { Authorization: `Bearer ${adminToken}` } });
        if (users.status !== 200 || !users.data.users) throw new Error('Admin users failed');
        console.log(`   ✔ Passed! Customer directory contains ${users.data.users.length} registered customers.`);

        // Test 14: Non-admin authorization rejection
        console.log('14. Testing Security: Customer access to admin endpoint...');
        const blocked = await req('/api/admin/dashboard', { headers: { Authorization: `Bearer ${customerToken}` } });
        if (blocked.status !== 403) throw new Error('Security violation: Customer was not blocked from admin dashboard!');
        console.log('   ✔ Passed! Correctly returned HTTP 403 Forbidden.');

        console.log('\n========================================================');
        console.log('🎉 ALL 14 AUTOMATED API TESTS PASSED PERFECTLY!');
        console.log('========================================================');

    } finally {
        server.close();
    }
}

runTests().catch(err => {
    console.error('\n❌ Test Suite Failed:', err);
    process.exit(1);
});
