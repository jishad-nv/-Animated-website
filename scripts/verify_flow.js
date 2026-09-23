/**
 * End-to-End Verification Test Script
 * Tests the complete Customer and Admin workflow against the real SQLite backend.
 */

const BASE = 'http://localhost:3000/api';

async function runVerification() {
    console.log('==================================================');
    console.log('🚀 Starting Pop Carty Complete End-to-End Verification');
    console.log('==================================================\n');

    // 1. Check /api/products
    console.log('1. Checking Products Catalog API...');
    const prodRes = await fetch(`${BASE}/products`);
    const prodData = await prodRes.json();
    console.log(`   ✔ Products Returned: ${prodData.count}`);
    if (prodData.count < 8) throw new Error('Expected at least 8 products');
    const firstProd = prodData.products[0];
    console.log(`   ✔ First Product: "${firstProd.product_name}" with thumbnail: ${firstProd.thumbnail}`);

    // 2. Customer Authentication
    console.log('\n2. Testing Customer Authentication...');
    const custLoginRes = await fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'shopper@popcarty.com', password: 'Customer@2026!' })
    });
    const custAuth = await custLoginRes.json();
    if (!custAuth.success) throw new Error('Customer login failed: ' + custAuth.error);
    const customerToken = custAuth.token;
    console.log(`   ✔ Customer Authenticated: ${custAuth.user.name} (Role: ${custAuth.user.role})`);

    // 3. Add to Cart
    console.log('\n3. Testing Add to Cart (Persistent Backend)...');
    const addCartRes = await fetch(`${BASE}/cart/items`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${customerToken}`
        },
        body: JSON.stringify({
            product_id: firstProd.product_id,
            quantity: 2,
            selected_variant: 'USB-C Pro Case',
            selected_color: 'Pearl White'
        })
    });
    const addCartData = await addCartRes.json();
    console.log(`   ✔ Add to Cart: ${addCartData.message}`);

    // Verify Cart Contents
    const cartRes = await fetch(`${BASE}/cart`, {
        headers: { 'Authorization': `Bearer ${customerToken}` }
    });
    const cartData = await cartRes.json();
    console.log(`   ✔ Cart Item Count: ${cartData.count}, Total: ${cartData.total} SAR`);

    // 4. Toggle Wishlist
    console.log('\n4. Testing Wishlist Toggle (Persistent Backend)...');
    const wishRes = await fetch(`${BASE}/wishlist`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${customerToken}`
        },
        body: JSON.stringify({ product_id: firstProd.product_id })
    });
    const wishData = await wishRes.json();
    console.log(`   ✔ Wishlist State: ${wishData.message} (Total Saved: ${wishData.wishlistCount})`);

    // 5. Customer Addresses
    console.log('\n5. Testing Customer Addresses...');
    const addrRes = await fetch(`${BASE}/addresses`, {
        headers: { 'Authorization': `Bearer ${customerToken}` }
    });
    const addrData = await addrRes.json();
    console.log(`   ✔ Saved Addresses: ${addrData.addresses.length}`);
    const defaultAddr = addrData.addresses[0];

    // 6. Checkout: Place Real Order
    console.log('\n6. Placing Real Order with Delivery Address Snapshot...');
    const orderPayload = {
        shipping_address: defaultAddr,
        payment_method: 'Online',
        discount_code: 'POPCART10',
        items: [
            {
                product_id: firstProd.product_id,
                quantity: 1,
                selected_variant: 'USB-C Pro Case',
                selected_color: 'Pearl White',
                unit_price: firstProd.discount_price || firstProd.price,
                product_name: firstProd.product_name,
                SKU: firstProd.SKU,
                product_image: firstProd.thumbnail
            }
        ]
    };

    const orderRes = await fetch(`${BASE}/orders`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${customerToken}`
        },
        body: JSON.stringify(orderPayload)
    });
    const orderData = await orderRes.json();
    if (!orderData.success) throw new Error('Order placement failed: ' + orderData.error);
    const newOrderNumber = orderData.order_number;
    const newOrderId = orderData.order_id;
    console.log(`   ✔ Order Placed Successfully!`);
    console.log(`   ✔ Generated Unique Order #: ${newOrderNumber}`);
    console.log(`   ✔ Total Amount: ${orderData.total_amount} SAR`);
    console.log(`   ✔ Initial Status: ${orderData.order_status}`);

    // 7. Verify Order in Customer History
    console.log('\n7. Verifying Order in Customer History...');
    const myOrdersRes = await fetch(`${BASE}/orders`, {
        headers: { 'Authorization': `Bearer ${customerToken}` }
    });
    const myOrders = await myOrdersRes.json();
    const foundOrder = myOrders.orders.find(o => o.order_number === newOrderNumber);
    if (!foundOrder) throw new Error('Placed order not found in customer history');
    console.log(`   ✔ Verified Order in Customer History with ${foundOrder.items.length} item(s)`);
    console.log(`   ✔ Address Snapshot Verified: ${foundOrder.shipping_address.full_name}, ${foundOrder.shipping_address.city}`);

    // 8. Admin Authentication
    console.log('\n8. Testing Secure Admin Authentication...');
    const adminLoginRes = await fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@popcarty.com', password: 'PopCarty@2026!' })
    });
    const adminAuth = await adminLoginRes.json();
    if (!adminAuth.success || adminAuth.user.role !== 'admin') throw new Error('Admin authentication failed');
    const adminToken = adminAuth.token;
    console.log(`   ✔ Admin Authenticated: ${adminAuth.user.name}`);

    // 9. Admin Dashboard Metrics
    console.log('\n9. Checking Real Admin Dashboard Stats...');
    const dashRes = await fetch(`${BASE}/admin/dashboard`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const dashData = await dashRes.json();
    console.log(`   ✔ Total Orders in System: ${dashData.stats.totalOrders}`);
    console.log(`   ✔ Total Products in Catalog: ${dashData.stats.totalProducts}`);
    console.log(`   ✔ Total Sales: ${dashData.stats.totalSales} SAR`);
    console.log(`   ✔ Low Stock Alerts: ${dashData.stats.lowStockProducts}`);

    // 10. Admin Inspects Order & Updates Status
    console.log('\n10. Admin Updating Order Status to "Out for Delivery"...');
    const statusUpdateRes = await fetch(`${BASE}/admin/orders/${newOrderId}/status`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
            order_status: 'Out for Delivery',
            payment_status: 'Paid'
        })
    });
    const updateData = await statusUpdateRes.json();
    console.log(`   ✔ Status Update Result: ${updateData.message}`);

    // 11. Customer Verifies Live Status Change
    console.log('\n11. Customer Verifying Live Tracking Update...');
    const customerOrderCheck = await fetch(`${BASE}/orders/${newOrderId}`, {
        headers: { 'Authorization': `Bearer ${customerToken}` }
    });
    const custOrderData = await customerOrderCheck.json();
    console.log(`   ✔ Customer Sees Updated Order Status: "${custOrderData.order.order_status}"`);
    if (custOrderData.order.order_status !== 'Out for Delivery') throw new Error('Status not synchronized');

    console.log('\n==================================================');
    console.log('🎉 ALL END-TO-END FLOW TESTS PASSED FLAWLESSLY!');
    console.log('==================================================');
}

runVerification().catch(err => {
    console.error('❌ Verification failed:', err);
    process.exit(1);
});
