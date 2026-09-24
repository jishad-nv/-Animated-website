/**
 * Pop Carty - Production REST API Backend Service
 * Independent Node.js / Express backend service supporting:
 * - Persistent Managed PostgreSQL database (Neon, Supabase, Render, Railway, etc.)
 * - Local SQLite fallback for offline development
 * - Complete customer store APIs & secure admin control center
 * - Vercel CORS compatibility
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Load environment configuration
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    try {
        const envContent = fs.readFileSync(envPath, 'utf8');
        for (const line of envContent.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx !== -1) {
                const key = trimmed.slice(0, eqIdx).trim();
                const val = trimmed.slice(eqIdx + 1).trim();
                if (process.env[key] === undefined) {
                    process.env[key] = val;
                }
            }
        }
    } catch (e) {
        console.warn('Could not read .env file:', e.message);
    }
}

const { db, hashPassword, verifyPassword, readyPromise } = require('./db.js');
const imageTo3d = require('./image_to_3d.js');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'popcarty_ultra_secure_production_secret_2026';

// CORS configuration for Vercel frontend and custom domains
const allowedOrigins = process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(',').map(s => s.trim())
    : ['*'];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(null, true); // Allow all for seamless frontend connectivity
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Pragma', 'Cache-Control'],
    credentials: true
}));

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Static asset folders for uploads & 3D models
const UPLOADS_DIR = path.join(__dirname, 'assets', 'products', 'uploads');
const MODELS_DIR = path.join(__dirname, 'assets', 'models');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true });

app.use('/assets/products/uploads', express.static(UPLOADS_DIR));
app.use('/assets/models', express.static(MODELS_DIR));

// Also serve product images if present in assets/products
const PRODUCTS_ASSETS_DIR = path.join(__dirname, '..', 'assets', 'products');
if (fs.existsSync(PRODUCTS_ASSETS_DIR)) {
    app.use('/assets/products', express.static(PRODUCTS_ASSETS_DIR));
}
const ROOT_ASSETS_DIR = path.join(__dirname, '..', 'assets');
if (fs.existsSync(ROOT_ASSETS_DIR)) {
    app.use('/assets', express.static(ROOT_ASSETS_DIR));
}

// -------------------------------------------------------------
// Helper Utilities & Middleware
// -------------------------------------------------------------
function generateToken(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const data = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString('base64url');
    const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${data}`).digest('base64url');
    return `${header}.${data}.${signature}`;
}

function verifyToken(token) {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, data, signature] = parts;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${data}`).digest('base64url');
    if (signature !== expected) return null;
    try {
        const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
        if (payload.exp && Date.now() > payload.exp) return null;
        return payload;
    } catch {
        return null;
    }
}

function getAuthUser(req) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return null;
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    return verifyToken(token);
}

function requireAdmin(req, res, next) {
    const auth = getAuthUser(req);
    if (!auth || auth.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Forbidden: Admin authorization required' });
    }
    req.authUser = auth;
    next();
}

// Wait for database schema ready middleware
app.use(async (req, res, next) => {
    try {
        await readyPromise;
        next();
    } catch (err) {
        res.status(500).json({ success: false, error: 'Database initializing: ' + err.message });
    }
});

// -------------------------------------------------------------
// Health Check Endpoint
// -------------------------------------------------------------
app.get(['/api/health', '/health'], (req, res) => {
    res.json({
        status: 'ok',
        service: 'Pop Carty API Service',
        database: db.isPostgres ? 'postgresql' : 'sqlite',
        version: '2.0.0',
        timestamp: new Date().toISOString()
    });
});

// -------------------------------------------------------------
// 1. AUTHENTICATION APIS
// -------------------------------------------------------------
app.post('/api/auth/register', async (req, res) => {
    const { name, email, phone, password } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ success: false, error: 'Name, email, and password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = await db.get('SELECT user_id FROM users WHERE email = ?', [cleanEmail]);
    if (existing) {
        return res.status(409).json({ success: false, error: 'An account with this email already exists.' });
    }

    const passwordHash = hashPassword(password);
    const result = await db.run(`
        INSERT INTO users (name, email, phone, password_hash, role)
        VALUES (?, ?, ?, ?, 'customer')
    `, [name.trim(), cleanEmail, phone ? phone.trim() : null, passwordHash]);

    const userId = result.lastInsertRowid;
    const token = generateToken({ user_id: userId, email: cleanEmail, role: 'customer' });

    res.status(201).json({
        success: true,
        message: 'Account created successfully',
        token,
        user: { user_id: userId, name: name.trim(), email: cleanEmail, phone, role: 'customer' }
    });
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await db.get('SELECT * FROM users WHERE email = ?', [cleanEmail]);

    if (!user || !verifyPassword(password, user.password_hash)) {
        return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const token = generateToken({ user_id: user.user_id, email: user.email, role: user.role });

    res.json({
        success: true,
        message: 'Login successful',
        token,
        user: {
            user_id: user.user_id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: user.role
        }
    });
});

app.get('/api/auth/me', async (req, res) => {
    const auth = getAuthUser(req);
    if (!auth) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const user = await db.get('SELECT user_id, name, email, phone, role, created_at FROM users WHERE user_id = ?', [auth.user_id]);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    res.json({ success: true, user });
});

// -------------------------------------------------------------
// 2. PRODUCTS APIS (CUSTOMER & PUBLIC)
// -------------------------------------------------------------
app.get('/api/products', async (req, res) => {
    const { category, search, featured, bestseller } = req.query;

    let sql = 'SELECT * FROM products WHERE active = 1';
    const params = [];

    if (category && category !== 'all') {
        sql += ' AND category = ?';
        params.push(category);
    }
    if (featured) {
        sql += ' AND featured = 1';
    }
    if (bestseller) {
        sql += ' AND bestseller = 1';
    }
    if (search) {
        sql += ' AND (product_name LIKE ? OR description LIKE ? OR brand LIKE ? OR SKU LIKE ?)';
        const term = `%${search.trim()}%`;
        params.push(term, term, term, term);
    }

    sql += ' ORDER BY product_id ASC';
    const rows = await db.all(sql, params);

    const products = rows.map(r => {
        const hasValidGlb = !!(r.glb_url && r.generation_status_3d === 'ready');
        return {
            ...r,
            price: parseFloat(r.price),
            discount_price: r.discount_price ? parseFloat(r.discount_price) : null,
            model_3d: r.model_3d || 'auto',
            glb_url: hasValidGlb ? r.glb_url : null,
            enable_3d: hasValidGlb ? 1 : 0,
            generation_status_3d: hasValidGlb ? 'ready' : 'none',
            images: r.images ? (typeof r.images === 'string' ? JSON.parse(r.images) : r.images) : [],
            variants: r.variants ? (typeof r.variants === 'string' ? JSON.parse(r.variants) : r.variants) : [],
            colors: r.colors ? (typeof r.colors === 'string' ? JSON.parse(r.colors) : r.colors) : [],
            specifications: r.specifications ? (typeof r.specifications === 'string' ? JSON.parse(r.specifications) : r.specifications) : {}
        };
    });

    res.json({ success: true, count: products.length, products });
});

app.get('/api/products/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid product ID' });

    const row = await db.get('SELECT * FROM products WHERE product_id = ? AND active = 1', [id]);
    if (!row) return res.status(404).json({ success: false, error: 'Product not found' });

    const hasValidGlb = !!(row.glb_url && row.generation_status_3d === 'ready');
    const product = {
        ...row,
        price: parseFloat(row.price),
        discount_price: row.discount_price ? parseFloat(row.discount_price) : null,
        model_3d: row.model_3d || 'auto',
        glb_url: hasValidGlb ? row.glb_url : null,
        enable_3d: hasValidGlb ? 1 : 0,
        generation_status_3d: hasValidGlb ? 'ready' : 'none',
        images: row.images ? (typeof row.images === 'string' ? JSON.parse(row.images) : row.images) : [],
        variants: row.variants ? (typeof row.variants === 'string' ? JSON.parse(row.variants) : row.variants) : [],
        colors: row.colors ? (typeof row.colors === 'string' ? JSON.parse(row.colors) : row.colors) : [],
        specifications: row.specifications ? (typeof row.specifications === 'string' ? JSON.parse(row.specifications) : row.specifications) : {}
    };

    res.json({ success: true, product });
});

app.get('/api/categories', async (req, res) => {
    const categories = await db.all('SELECT * FROM categories ORDER BY category_id ASC');
    res.json({ success: true, categories });
});

// -------------------------------------------------------------
// 3. CART APIS (PERSISTENT BACKEND)
// -------------------------------------------------------------
app.get('/api/cart', async (req, res) => {
    const auth = getAuthUser(req);
    const userId = auth ? auth.user_id : 2;

    const items = await db.all(`
        SELECT c.cart_item_id, c.user_id, c.product_id, c.quantity, c.selected_variant, 
               c.selected_color, c.price, c.created_at,
               p.product_name, p.SKU, p.thumbnail, p.stock, p.category, p.discount_price
        FROM cart_items c
        JOIN products p ON c.product_id = p.product_id
        WHERE c.user_id = ?
        ORDER BY c.created_at DESC
    `, [userId]);

    const total = items.reduce((acc, item) => acc + parseFloat(item.price) * item.quantity, 0);
    res.json({ success: true, items, total: Math.round(total * 100) / 100, count: items.length });
});

app.post('/api/cart/items', async (req, res) => {
    const auth = getAuthUser(req);
    const userId = auth ? auth.user_id : 2;
    const { product_id, quantity = 1, selected_variant, selected_color } = req.body;

    if (!product_id) return res.status(400).json({ success: false, error: 'Product ID is required' });

    const product = await db.get('SELECT * FROM products WHERE product_id = ? AND active = 1', [product_id]);
    if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
    if (product.stock <= 0) return res.status(400).json({ success: false, error: 'Product is out of stock' });

    const unitPrice = parseFloat(product.discount_price || product.price);

    const existing = await db.get(`
        SELECT cart_item_id, quantity FROM cart_items
        WHERE user_id = ? AND product_id = ? 
          AND (selected_variant = ? OR (selected_variant IS NULL AND ? IS NULL))
          AND (selected_color = ? OR (selected_color IS NULL AND ? IS NULL))
    `, [userId, product_id, selected_variant || null, selected_variant || null, selected_color || null, selected_color || null]);

    if (existing) {
        const newQty = existing.quantity + quantity;
        if (newQty > product.stock) {
            return res.status(400).json({ success: false, error: `Cannot add more. Only ${product.stock} items in stock.` });
        }
        await db.run('UPDATE cart_items SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE cart_item_id = ?', [newQty, existing.cart_item_id]);
    } else {
        await db.run(`
            INSERT INTO cart_items (user_id, product_id, quantity, selected_variant, selected_color, price)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [userId, product_id, quantity, selected_variant || null, selected_color || null, unitPrice]);
    }

    res.json({ success: true, message: 'Item added to Pop Carty' });
});

app.put('/api/cart/items/:id', async (req, res) => {
    const auth = getAuthUser(req);
    const userId = auth ? auth.user_id : 2;
    const cartItemId = parseInt(req.params.id, 10);
    const { quantity } = req.body;

    if (quantity <= 0) {
        await db.run('DELETE FROM cart_items WHERE cart_item_id = ? AND user_id = ?', [cartItemId, userId]);
        return res.json({ success: true, message: 'Item removed from cart' });
    }

    const item = await db.get(`
        SELECT c.*, p.stock FROM cart_items c 
        JOIN products p ON c.product_id = p.product_id 
        WHERE c.cart_item_id = ? AND c.user_id = ?
    `, [cartItemId, userId]);

    if (!item) return res.status(404).json({ success: false, error: 'Cart item not found' });
    if (quantity > item.stock) return res.status(400).json({ success: false, error: `Stock limit reached. Max available: ${item.stock}` });

    await db.run('UPDATE cart_items SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE cart_item_id = ?', [quantity, cartItemId]);
    res.json({ success: true, message: 'Cart quantity updated' });
});

app.delete('/api/cart/items/:id', async (req, res) => {
    const auth = getAuthUser(req);
    const userId = auth ? auth.user_id : 2;
    const cartItemId = parseInt(req.params.id, 10);

    await db.run('DELETE FROM cart_items WHERE cart_item_id = ? AND user_id = ?', [cartItemId, userId]);
    res.json({ success: true, message: 'Item removed from cart' });
});

app.delete('/api/cart', async (req, res) => {
    const auth = getAuthUser(req);
    const userId = auth ? auth.user_id : 2;

    await db.run('DELETE FROM cart_items WHERE user_id = ?', [userId]);
    res.json({ success: true, message: 'Cart cleared' });
});

// -------------------------------------------------------------
// 4. WISHLIST APIS (PERSISTENT BACKEND)
// -------------------------------------------------------------
app.get('/api/wishlist', async (req, res) => {
    const auth = getAuthUser(req);
    const userId = auth ? auth.user_id : 2;

    const items = await db.all(`
        SELECT w.wishlist_id, w.created_at, p.*
        FROM wishlist w
        JOIN products p ON w.product_id = p.product_id
        WHERE w.user_id = ? AND p.active = 1
        ORDER BY w.created_at DESC
    `, [userId]);

    const productIds = items.map(i => i.product_id);
    res.json({ success: true, count: items.length, productIds, items });
});

app.post('/api/wishlist', async (req, res) => {
    const auth = getAuthUser(req);
    const userId = auth ? auth.user_id : 2;
    const { product_id } = req.body;

    if (!product_id) return res.status(400).json({ success: false, error: 'Product ID is required' });

    const existing = await db.get('SELECT wishlist_id FROM wishlist WHERE user_id = ? AND product_id = ?', [userId, product_id]);

    let inWishlist = false;
    if (existing) {
        await db.run('DELETE FROM wishlist WHERE wishlist_id = ?', [existing.wishlist_id]);
        inWishlist = false;
    } else {
        await db.run('INSERT INTO wishlist (user_id, product_id) VALUES (?, ?)', [userId, product_id]);
        inWishlist = true;
    }

    const countRow = await db.get('SELECT COUNT(*) as count FROM wishlist WHERE user_id = ?', [userId]);
    const count = parseInt(countRow ? countRow.count : 0, 10);

    res.json({
        success: true,
        inWishlist,
        wishlistCount: count,
        message: inWishlist ? 'Saved to Wishlist' : 'Removed from Wishlist'
    });
});

app.delete('/api/wishlist/:productId', async (req, res) => {
    const auth = getAuthUser(req);
    const userId = auth ? auth.user_id : 2;
    const productId = parseInt(req.params.productId, 10);

    await db.run('DELETE FROM wishlist WHERE user_id = ? AND product_id = ?', [userId, productId]);
    res.json({ success: true, message: 'Removed from Wishlist' });
});

// -------------------------------------------------------------
// 5. ADDRESSES APIS
// -------------------------------------------------------------
app.get('/api/addresses', async (req, res) => {
    const auth = getAuthUser(req);
    const userId = auth ? auth.user_id : 2;

    const addresses = await db.all('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC', [userId]);
    res.json({ success: true, addresses });
});

app.post('/api/addresses', async (req, res) => {
    const auth = getAuthUser(req);
    const userId = auth ? auth.user_id : 2;
    const {
        full_name, phone, house_name, house_number, street, area,
        city, district, state, country = 'Saudi Arabia', pincode, landmark,
        address_type = 'Home', is_default = 0
    } = req.body;

    if (!full_name || !phone || !street || !city || !state || !pincode) {
        return res.status(400).json({ success: false, error: 'Full name, phone, street, city, state, and pincode are required' });
    }

    if (is_default) {
        await db.run('UPDATE addresses SET is_default = 0 WHERE user_id = ?', [userId]);
    }

    const resInsert = await db.run(`
        INSERT INTO addresses (
            user_id, full_name, phone, house_name, house_number, street, area,
            city, district, state, country, pincode, landmark, address_type, is_default
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        userId, full_name.trim(), phone.trim(), house_name || null, house_number || null,
        street.trim(), area || null, city.trim(), district || null, state.trim(),
        country.trim(), pincode.trim(), landmark || null, address_type, is_default ? 1 : 0
    ]);

    res.status(201).json({
        success: true,
        address_id: resInsert.lastInsertRowid,
        message: 'Address saved successfully'
    });
});

app.put('/api/addresses/:id', async (req, res) => {
    const auth = getAuthUser(req);
    const userId = auth ? auth.user_id : 2;
    const addressId = parseInt(req.params.id, 10);
    const body = req.body;

    const current = await db.get('SELECT * FROM addresses WHERE address_id = ? AND user_id = ?', [addressId, userId]);
    if (!current) return res.status(404).json({ success: false, error: 'Address not found' });

    if (body.is_default) {
        await db.run('UPDATE addresses SET is_default = 0 WHERE user_id = ?', [userId]);
    }

    await db.run(`
        UPDATE addresses SET
            full_name = ?, phone = ?, house_name = ?, house_number = ?, street = ?, area = ?,
            city = ?, district = ?, state = ?, country = ?, pincode = ?, landmark = ?,
            address_type = ?, is_default = ?, updated_at = CURRENT_TIMESTAMP
        WHERE address_id = ? AND user_id = ?
    `, [
        body.full_name || current.full_name,
        body.phone || current.phone,
        body.house_name !== undefined ? body.house_name : current.house_name,
        body.house_number !== undefined ? body.house_number : current.house_number,
        body.street || current.street,
        body.area !== undefined ? body.area : current.area,
        body.city || current.city,
        body.district !== undefined ? body.district : current.district,
        body.state || current.state,
        body.country || current.country,
        body.pincode || current.pincode,
        body.landmark !== undefined ? body.landmark : current.landmark,
        body.address_type || current.address_type,
        body.is_default !== undefined ? (body.is_default ? 1 : 0) : current.is_default,
        addressId,
        userId
    ]);

    res.json({ success: true, message: 'Address updated successfully' });
});

app.delete('/api/addresses/:id', async (req, res) => {
    const auth = getAuthUser(req);
    const userId = auth ? auth.user_id : 2;
    const addressId = parseInt(req.params.id, 10);

    await db.run('DELETE FROM addresses WHERE address_id = ? AND user_id = ?', [addressId, userId]);
    res.json({ success: true, message: 'Address deleted successfully' });
});

// -------------------------------------------------------------
// 6. ORDERS APIS (CHECKOUT & ORDER HISTORY)
// -------------------------------------------------------------
app.post('/api/orders', async (req, res) => {
    const auth = getAuthUser(req);
    const userId = auth ? auth.user_id : 2;
    const { items, shipping_address, payment_method = 'COD', discount_code } = req.body;

    let orderItems = items;
    if (!orderItems || orderItems.length === 0) {
        orderItems = await db.all(`
            SELECT c.product_id, c.quantity, c.selected_variant, c.selected_color,
                   p.product_name, p.SKU, p.thumbnail as product_image, p.price, p.discount_price, p.stock
            FROM cart_items c
            JOIN products p ON c.product_id = p.product_id
            WHERE c.user_id = ?
        `, [userId]);
    }

    if (!orderItems || orderItems.length === 0) {
        return res.status(400).json({ success: false, error: 'Cannot place order: Cart is empty' });
    }

    if (!shipping_address || !shipping_address.full_name || !shipping_address.street || !shipping_address.city) {
        return res.status(400).json({ success: false, error: 'Valid shipping address is required' });
    }

    // Verify stock availability
    for (const item of orderItems) {
        const p = await db.get('SELECT stock, product_name FROM products WHERE product_id = ?', [item.product_id]);
        if (!p || p.stock < item.quantity) {
            return res.status(400).json({
                success: false,
                error: `Insufficient stock for "${p ? p.product_name : 'Item'}". Available: ${p ? p.stock : 0}`
            });
        }
    }

    // Calculate totals
    let subtotal = 0;
    const processedItems = orderItems.map(item => {
        const unitPrice = parseFloat(item.discount_price || item.price || item.unit_price);
        const finalPrice = unitPrice * item.quantity;
        subtotal += finalPrice;
        return {
            product_id: item.product_id,
            product_name: item.product_name,
            SKU: item.SKU || 'POP-ITEM',
            product_image: item.product_image || item.thumbnail || '',
            quantity: item.quantity,
            unit_price: unitPrice,
            discount: 0,
            final_price: finalPrice,
            selected_variant: item.selected_variant || 'Standard',
            selected_color: item.selected_color || 'Default'
        };
    });

    let discount = 0;
    if (discount_code && discount_code.toUpperCase() === 'POPCART10') {
        discount = Math.round(subtotal * 0.10 * 100) / 100;
    }

    const delivery_charge = subtotal > 50 ? 0.00 : 15.00;
    const taxable = subtotal - discount;
    const tax = Math.round(taxable * 0.15 * 100) / 100;
    const total_amount = Math.round((taxable + delivery_charge + tax) * 100) / 100;

    const countRow = await db.get('SELECT COUNT(*) as count FROM orders');
    const nextOrderCount = parseInt(countRow ? countRow.count : 0, 10) + 1;
    const order_number = `POP-2026-${String(nextOrderCount).padStart(6, '0')}`;

    const now = new Date();
    const order_date = now.toISOString().split('T')[0];
    const order_time = now.toTimeString().split(' ')[0];

    const shipping_address_json = JSON.stringify({
        full_name: shipping_address.full_name,
        phone: shipping_address.phone,
        house_name: shipping_address.house_name || '',
        house_number: shipping_address.house_number || '',
        street: shipping_address.street,
        area: shipping_address.area || '',
        city: shipping_address.city,
        district: shipping_address.district || '',
        state: shipping_address.state || '',
        country: shipping_address.country || 'Saudi Arabia',
        pincode: shipping_address.pincode || '',
        landmark: shipping_address.landmark || ''
    });

    const payment_status = payment_method === 'Online' ? 'Paid' : 'Pending';

    const orderInsert = await db.run(`
        INSERT INTO orders (
            order_number, user_id, order_date, order_time, subtotal, discount,
            delivery_charge, tax, total_amount, payment_method, payment_status,
            order_status, shipping_address_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Confirmed', ?)
    `, [
        order_number, userId, order_date, order_time, subtotal, discount,
        delivery_charge, tax, total_amount, payment_method, payment_status,
        shipping_address_json
    ]);

    const order_id = orderInsert.lastInsertRowid;

    for (const pi of processedItems) {
        await db.run(`
            INSERT INTO order_items (
                order_id, product_id, product_name, SKU, product_image, quantity,
                unit_price, discount, final_price, selected_variant, selected_color
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            order_id, pi.product_id, pi.product_name, pi.SKU, pi.product_image,
            pi.quantity, pi.unit_price, pi.discount, pi.final_price,
            pi.selected_variant, pi.selected_color
        ]);

        await db.run(`
            UPDATE products 
            SET stock = MAX(0, stock - ?), updated_at = CURRENT_TIMESTAMP 
            WHERE product_id = ?
        `, [pi.quantity, pi.product_id]);
    }

    const txnId = payment_method === 'Online'
        ? `TXN_${Date.now()}_${Math.floor(Math.random() * 100000)}`
        : `COD_REF_${order_number}`;

    await db.run(`
        INSERT INTO payments (order_id, payment_method, payment_status, transaction_id, amount)
        VALUES (?, ?, ?, ?, ?)
    `, [order_id, payment_method, payment_status, txnId, total_amount]);

    await db.run('DELETE FROM cart_items WHERE user_id = ?', [userId]);

    await db.run(`
        INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
        VALUES (?, 'ORDER_CREATED', 'ORDER', ?, ?)
    `, [userId, order_number, `Order placed with ${processedItems.length} items. Total: ${total_amount} SAR via ${payment_method}`]);

    res.status(201).json({
        success: true,
        message: 'Order placed successfully',
        order_id,
        order_number,
        total_amount,
        payment_status,
        order_status: 'Confirmed'
    });
});

app.get('/api/orders', async (req, res) => {
    const auth = getAuthUser(req);
    const userId = auth ? auth.user_id : 2;

    const orders = await db.all('SELECT * FROM orders WHERE user_id = ? ORDER BY order_id DESC', [userId]);
    const enriched = [];
    for (const o of orders) {
        const items = await db.all('SELECT * FROM order_items WHERE order_id = ?', [o.order_id]);
        enriched.push({
            ...o,
            total_amount: parseFloat(o.total_amount),
            shipping_address: JSON.parse(o.shipping_address_json),
            items: items.map(it => ({ ...it, final_price: parseFloat(it.final_price) }))
        });
    }

    res.json({ success: true, count: enriched.length, orders: enriched });
});

app.get('/api/orders/:id', async (req, res) => {
    const auth = getAuthUser(req);
    const userId = auth ? auth.user_id : 2;
    const orderId = parseInt(req.params.id, 10);

    const order = await db.get('SELECT * FROM orders WHERE order_id = ? AND user_id = ?', [orderId, userId]);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    const items = await db.all('SELECT * FROM order_items WHERE order_id = ?', [order.order_id]);
    const payment = await db.get('SELECT * FROM payments WHERE order_id = ?', [order.order_id]);

    res.json({
        success: true,
        order: {
            ...order,
            total_amount: parseFloat(order.total_amount),
            shipping_address: JSON.parse(order.shipping_address_json),
            items,
            payment
        }
    });
});

// -------------------------------------------------------------
// 7. SECURE ADMIN BACKEND APIS (ROLE: ADMIN)
// -------------------------------------------------------------
app.get('/api/admin/dashboard', requireAdmin, async (req, res) => {
    const totalProducts = (await db.get('SELECT COUNT(*) as count FROM products WHERE active = 1')).count;
    const totalCustomers = (await db.get("SELECT COUNT(*) as count FROM users WHERE role = 'customer'")).count;
    const totalOrders = (await db.get('SELECT COUNT(*) as count FROM orders')).count;
    const pendingOrders = (await db.get("SELECT COUNT(*) as count FROM orders WHERE order_status IN ('Pending', 'Processing')")).count;
    const completedOrders = (await db.get("SELECT COUNT(*) as count FROM orders WHERE order_status = 'Delivered'")).count;
    const cancelledOrders = (await db.get("SELECT COUNT(*) as count FROM orders WHERE order_status = 'Cancelled'")).count;
    const totalSalesRow = await db.get("SELECT SUM(total_amount) as total FROM orders WHERE payment_status = 'Paid'");
    const totalSales = totalSalesRow ? (parseFloat(totalSalesRow.total) || 0) : 0;
    const lowStockProducts = (await db.get('SELECT COUNT(*) as count FROM products WHERE stock <= 5 AND active = 1')).count;

    const recentOrders = await db.all(`
        SELECT o.order_id, o.order_number, o.order_date, o.total_amount, o.order_status, o.payment_status,
               u.name as customer_name, u.email as customer_email
        FROM orders o
        JOIN users u ON o.user_id = u.user_id
        ORDER BY o.order_id DESC LIMIT 6
    `);

    res.json({
        success: true,
        stats: {
            totalProducts: parseInt(totalProducts, 10),
            totalCustomers: parseInt(totalCustomers, 10),
            totalOrders: parseInt(totalOrders, 10),
            pendingOrders: parseInt(pendingOrders, 10),
            completedOrders: parseInt(completedOrders, 10),
            cancelledOrders: parseInt(cancelledOrders, 10),
            totalSales: Math.round(totalSales * 100) / 100,
            lowStockProducts: parseInt(lowStockProducts, 10)
        },
        recentOrders: recentOrders.map(o => ({ ...o, total_amount: parseFloat(o.total_amount) }))
    });
});

app.get('/api/admin/products', requireAdmin, async (req, res) => {
    const { search } = req.query;
    let sql = 'SELECT * FROM products';
    const params = [];

    if (search) {
        sql += ' WHERE product_name LIKE ? OR SKU LIKE ? OR category LIKE ?';
        const term = `%${search.trim()}%`;
        params.push(term, term, term);
    }
    sql += ' ORDER BY product_id DESC';

    const rows = await db.all(sql, params);
    const products = rows.map(p => ({
        ...p,
        price: parseFloat(p.price),
        discount_price: p.discount_price ? parseFloat(p.discount_price) : null,
        model_3d: p.model_3d || 'auto',
        glb_url: p.glb_url || null,
        enable_3d: p.enable_3d !== undefined ? parseInt(p.enable_3d, 10) : 0,
        generation_status_3d: p.generation_status_3d || 'none',
        images: p.images ? (typeof p.images === 'string' ? JSON.parse(p.images) : p.images) : [],
        variants: p.variants ? (typeof p.variants === 'string' ? JSON.parse(p.variants) : p.variants) : [],
        colors: p.colors ? (typeof p.colors === 'string' ? JSON.parse(p.colors) : p.colors) : [],
        specifications: p.specifications ? (typeof p.specifications === 'string' ? JSON.parse(p.specifications) : p.specifications) : {}
    }));

    res.json({ success: true, count: products.length, products });
});

app.get('/api/admin/products/:id', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid product ID' });

    const row = await db.get('SELECT * FROM products WHERE product_id = ?', [id]);
    if (!row) return res.status(404).json({ success: false, error: 'Product not found' });

    const product = {
        ...row,
        price: parseFloat(row.price),
        discount_price: row.discount_price ? parseFloat(row.discount_price) : null,
        model_3d: row.model_3d || 'auto',
        glb_url: row.glb_url || null,
        enable_3d: row.enable_3d !== undefined ? parseInt(row.enable_3d, 10) : 0,
        generation_status_3d: row.generation_status_3d || 'none',
        images: row.images ? (typeof row.images === 'string' ? JSON.parse(row.images) : row.images) : [],
        variants: row.variants ? (typeof row.variants === 'string' ? JSON.parse(row.variants) : row.variants) : [],
        colors: row.colors ? (typeof row.colors === 'string' ? JSON.parse(row.colors) : row.colors) : [],
        specifications: row.specifications ? (typeof row.specifications === 'string' ? JSON.parse(row.specifications) : row.specifications) : {}
    };

    res.json({ success: true, product });
});

app.post('/api/admin/products', requireAdmin, async (req, res) => {
    const {
        product_name, SKU, description, category, brand, price,
        discount_price, discount_percentage = 0, thumbnail, images,
        stock = 0, variants, colors, specifications, model_3d = 'auto',
        glb_url = null, enable_3d = 0, generation_status_3d = 'none',
        featured = 0, bestseller = 0
    } = req.body;

    if (!product_name || !SKU || !price || !category) {
        return res.status(400).json({ success: false, error: 'Product name, SKU, price, and category are required' });
    }

    const existing = await db.get('SELECT product_id FROM products WHERE SKU = ?', [SKU.trim()]);
    if (existing) return res.status(409).json({ success: false, error: 'SKU already exists' });

    const resInsert = await db.run(`
        INSERT INTO products (
            product_name, SKU, description, category, brand, price, discount_price,
            discount_percentage, images, thumbnail, stock, variants, colors,
            specifications, model_3d, glb_url, enable_3d, generation_status_3d, featured, bestseller, active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `, [
        product_name.trim(),
        SKU.trim(),
        description || '',
        category.trim(),
        brand ? brand.trim() : 'Pop Carty',
        parseFloat(price),
        discount_price ? parseFloat(discount_price) : null,
        parseInt(discount_percentage, 10) || 0,
        typeof images === 'string' ? images : JSON.stringify(images || [thumbnail]),
        thumbnail || '/assets/products/airpods_pro.jpg',
        parseInt(stock, 10) || 0,
        typeof variants === 'string' ? variants : JSON.stringify(variants || ['Standard']),
        typeof colors === 'string' ? colors : JSON.stringify(colors || [{ name: 'Default', hex: '#000000' }]),
        typeof specifications === 'string' ? specifications : JSON.stringify(specifications || {}),
        model_3d || 'auto',
        glb_url || null,
        enable_3d ? 1 : 0,
        generation_status_3d || 'none',
        featured ? 1 : 0,
        bestseller ? 1 : 0
    ]);

    const newProductId = resInsert.lastInsertRowid;
    await db.run(`
        INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
        VALUES (?, 'PRODUCT_CREATED', 'PRODUCT', ?, ?)
    `, [req.authUser.user_id, SKU, `Admin added product: ${product_name}`]);

    // Auto-generate 3D if enabled
    try {
        const autoGenRow = await db.get("SELECT setting_value FROM app_settings WHERE setting_key = 'auto_generate_3d'");
        const isAutoGen = autoGenRow && (autoGenRow.setting_value === 'on' || autoGenRow.setting_value === '1');
        if (isAutoGen && process.env.MESHY_API_KEY) {
            const autoImgs = [];
            if (thumbnail) autoImgs.push(thumbnail);
            if (images) {
                try {
                    const parsedImgs = typeof images === 'string' ? JSON.parse(images) : images;
                    if (Array.isArray(parsedImgs)) {
                        for (const img of parsedImgs) {
                            if (img && !autoImgs.includes(img)) autoImgs.push(img);
                        }
                    }
                } catch (e) {}
            }
            if (autoImgs.length > 0) {
                imageTo3d.generateProduct3DModel(newProductId, autoImgs, db, { productName: product_name.trim() })
                    .catch(e => console.error(`[Auto 3D Error] Product ${newProductId}:`, e.message));
            }
        }
    } catch (e) {}

    res.status(201).json({
        success: true,
        product_id: newProductId,
        message: 'Product created successfully'
    });
});

app.put('/api/admin/products/:id', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const body = req.body;

    const current = await db.get('SELECT * FROM products WHERE product_id = ?', [id]);
    if (!current) return res.status(404).json({ success: false, error: 'Product not found' });

    const updatedName = body.product_name || current.product_name;
    const updatedSKU = body.SKU || current.SKU;
    const updatedPrice = body.price !== undefined ? parseFloat(body.price) : current.price;
    const updatedDiscountPrice = body.discount_price !== undefined ? parseFloat(body.discount_price) : current.discount_price;
    const updatedStock = body.stock !== undefined ? parseInt(body.stock, 10) : current.stock;
    const updatedThumb = body.thumbnail || current.thumbnail;
    const updatedCategory = body.category || current.category;
    const updatedBrand = body.brand || current.brand;
    const updatedDesc = body.description !== undefined ? body.description : current.description;
    const updatedActive = body.active !== undefined ? (body.active ? 1 : 0) : current.active;
    const updatedModel3d = body.model_3d !== undefined ? body.model_3d : (current.model_3d || 'auto');
    const updatedGlbUrl = body.glb_url !== undefined ? body.glb_url : current.glb_url;
    const updatedEnable3d = body.enable_3d !== undefined ? (body.enable_3d ? 1 : 0) : (current.enable_3d || 0);
    const updatedStatus3d = body.generation_status_3d !== undefined ? body.generation_status_3d : (current.generation_status_3d || 'none');
    const updatedFeatured = body.featured !== undefined ? (body.featured ? 1 : 0) : current.featured;
    const updatedBestseller = body.bestseller !== undefined ? (body.bestseller ? 1 : 0) : current.bestseller;

    let updatedImages = current.images;
    if (body.images !== undefined) {
        updatedImages = typeof body.images === 'string' ? body.images : JSON.stringify(body.images || []);
    }

    await db.run(`
        UPDATE products SET
            product_name = ?, SKU = ?, description = ?, category = ?, brand = ?,
            price = ?, discount_price = ?, thumbnail = ?, images = ?, stock = ?, active = ?,
            model_3d = ?, glb_url = ?, enable_3d = ?, generation_status_3d = ?,
            featured = ?, bestseller = ?, updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ?
    `, [
        updatedName, updatedSKU, updatedDesc, updatedCategory, updatedBrand,
        updatedPrice, updatedDiscountPrice, updatedThumb, updatedImages, updatedStock, updatedActive,
        updatedModel3d, updatedGlbUrl, updatedEnable3d, updatedStatus3d,
        updatedFeatured, updatedBestseller, id
    ]);

    await db.run(`
        INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
        VALUES (?, 'PRODUCT_UPDATED', 'PRODUCT', ?, ?)
    `, [req.authUser.user_id, updatedSKU, `Admin updated product ${updatedName} (Stock: ${updatedStock}, Price: ${updatedPrice}, Active: ${updatedActive})`]);

    res.json({ success: true, message: 'Product updated successfully' });
});

app.post('/api/admin/products/:id/reactivate', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const current = await db.get('SELECT * FROM products WHERE product_id = ?', [id]);
    if (!current) return res.status(404).json({ success: false, error: 'Product not found' });

    await db.run('UPDATE products SET active = 1, updated_at = CURRENT_TIMESTAMP WHERE product_id = ?', [id]);
    await db.run(`
        INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
        VALUES (?, 'PRODUCT_REACTIVATED', 'PRODUCT', ?, ?)
    `, [req.authUser.user_id, String(id), `Reactivated product ID: ${id}`]);

    res.json({ success: true, message: 'Product reactivated successfully' });
});

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const current = await db.get('SELECT * FROM products WHERE product_id = ?', [id]);
    if (!current) return res.status(404).json({ success: false, error: 'Product not found' });

    const permanent = req.query.permanent === '1' || req.query.hard === 'true';

    if (permanent) {
        if (current.glb_url) {
            try { await imageTo3d.deleteProduct3DModel(id, db); } catch(e) {}
        }
        await db.run('DELETE FROM products WHERE product_id = ?', [id]);
        await db.run(`
            INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
            VALUES (?, 'PRODUCT_DELETED', 'PRODUCT', ?, ?)
        `, [req.authUser.user_id, String(id), `Permanently deleted product ID: ${id} (${current.product_name})`]);

        res.json({ success: true, message: 'Product permanently deleted successfully' });
    } else {
        await db.run('UPDATE products SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE product_id = ?', [id]);
        await db.run(`
            INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
            VALUES (?, 'PRODUCT_DEACTIVATED', 'PRODUCT', ?, ?)
        `, [req.authUser.user_id, String(id), `Deactivated product ID: ${id} (${current.product_name})`]);

        res.json({ success: true, message: 'Product deactivated successfully' });
    }
});

// Orders Management
app.get('/api/admin/orders', requireAdmin, async (req, res) => {
    const { status, payment_status, search } = req.query;

    let sql = `
        SELECT o.*, u.name as customer_name, u.email as customer_email, u.phone as customer_phone
        FROM orders o
        JOIN users u ON o.user_id = u.user_id
        WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all') {
        sql += ' AND o.order_status = ?';
        params.push(status);
    }
    if (payment_status && payment_status !== 'all') {
        sql += ' AND o.payment_status = ?';
        params.push(payment_status);
    }
    if (search) {
        sql += ' AND (o.order_number LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)';
        const term = `%${search.trim()}%`;
        params.push(term, term, term, term);
    }

    sql += ' ORDER BY o.order_id DESC';
    const rows = await db.all(sql, params);

    const orders = [];
    for (const o of rows) {
        const items = await db.all('SELECT * FROM order_items WHERE order_id = ?', [o.order_id]);
        orders.push({
            ...o,
            total_amount: parseFloat(o.total_amount),
            shipping_address: JSON.parse(o.shipping_address_json),
            items: items.map(it => ({ ...it, final_price: parseFloat(it.final_price) }))
        });
    }

    res.json({ success: true, count: orders.length, orders });
});

app.get('/api/admin/orders/:id', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const order = await db.get(`
        SELECT o.*, u.name as customer_name, u.email as customer_email, u.phone as customer_phone, u.created_at as customer_since
        FROM orders o
        JOIN users u ON o.user_id = u.user_id
        WHERE o.order_id = ?
    `, [id]);

    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    const items = await db.all('SELECT * FROM order_items WHERE order_id = ?', [order.order_id]);
    const payment = await db.get('SELECT * FROM payments WHERE order_id = ?', [order.order_id]);

    res.json({
        success: true,
        order: {
            ...order,
            total_amount: parseFloat(order.total_amount),
            shipping_address: JSON.parse(order.shipping_address_json),
            items,
            payment
        }
    });
});

app.put('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { order_status, payment_status } = req.body;

    if (!order_status) return res.status(400).json({ success: false, error: 'Order status is required' });

    const validStatuses = [
        'Pending', 'Confirmed', 'Processing', 'Packed', 'Shipped', 
        'Out for Delivery', 'Delivered', 'Cancelled', 'Returned', 'Refunded'
    ];
    if (!validStatuses.includes(order_status)) {
        return res.status(400).json({ success: false, error: `Invalid order status. Must be one of: ${validStatuses.join(', ')}` });
    }

    if (payment_status) {
        await db.run('UPDATE orders SET order_status = ?, payment_status = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?', [order_status, payment_status, id]);
        await db.run('UPDATE payments SET payment_status = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?', [payment_status, id]);
    } else {
        await db.run('UPDATE orders SET order_status = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?', [order_status, id]);
    }

    await db.run(`
        INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
        VALUES (?, 'ORDER_STATUS_CHANGED', 'ORDER', ?, ?)
    `, [req.authUser.user_id, String(id), `Admin updated order ID ${id} status to: ${order_status}`]);

    res.json({ success: true, message: `Order status updated to ${order_status}` });
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
    const users = await db.all(`
        SELECT u.user_id, u.name, u.email, u.phone, u.role, u.created_at,
               COUNT(o.order_id) as total_orders,
               COALESCE(SUM(o.total_amount), 0) as total_spent
        FROM users u
        LEFT JOIN orders o ON u.user_id = o.user_id
        WHERE u.role = 'customer'
        GROUP BY u.user_id, u.name, u.email, u.phone, u.role, u.created_at
        ORDER BY u.created_at DESC
    `);

    res.json({
        success: true,
        count: users.length,
        users: users.map(u => ({ ...u, total_spent: parseFloat(u.total_spent) }))
    });
});

app.get('/api/admin/inventory', requireAdmin, async (req, res) => {
    const inventory = await db.all(`
        SELECT product_id, product_name, SKU, category, stock, price, thumbnail,
               CASE 
                   WHEN stock <= 0 THEN 'Out of Stock'
                   WHEN stock <= 5 THEN 'Low Stock'
                   ELSE 'In Stock'
               END as status
        FROM products
        WHERE active = 1
        ORDER BY stock ASC
    `);

    res.json({ success: true, inventory });
});

app.get('/api/admin/audit-logs', requireAdmin, async (req, res) => {
    const logs = await db.all(`
        SELECT a.*, u.name as admin_name, u.email as admin_email
        FROM audit_logs a
        LEFT JOIN users u ON a.user_id = u.user_id
        ORDER BY a.created_at DESC LIMIT 50
    `);

    res.json({ success: true, logs });
});

// 3D Engine Endpoints
app.post('/api/admin/products/:id/generate-3d', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const product = await db.get('SELECT * FROM products WHERE product_id = ?', [id]);
    if (!product) return res.status(404).json({ success: false, error: 'Product not found' });

    const meshyKey = process.env.MESHY_API_KEY ? process.env.MESHY_API_KEY.trim() : '';
    if (!meshyKey) {
        const missingMsg = 'AI 3D generation requires a Meshy API key.';
        imageTo3d.setProduct3DStatus(id, imageTo3d.STATUS.FAILED, 0, missingMsg);
        await imageTo3d.syncStatusToDb(id, imageTo3d.STATUS.FAILED, null, db);
        return res.status(400).json({ success: false, error: missingMsg });
    }

    let imagePaths = [];
    if (Array.isArray(req.body.image_paths) && req.body.image_paths.length > 0) {
        imagePaths = req.body.image_paths;
    } else {
        if (product.thumbnail) imagePaths.push(product.thumbnail);
        if (product.images) {
            try {
                const parsed = typeof product.images === 'string' ? JSON.parse(product.images) : product.images;
                if (Array.isArray(parsed)) {
                    for (const img of parsed) {
                        if (img && !imagePaths.includes(img)) imagePaths.push(img);
                    }
                }
            } catch (e) {}
        }
    }

    if (imagePaths.length === 0) {
        return res.status(400).json({ success: false, error: 'Product has no stored images to generate 3D model from' });
    }

    imageTo3d.setProduct3DStatus(id, imageTo3d.STATUS.PREPARING, 10, 'Preparing image...');
    await imageTo3d.syncStatusToDb(id, imageTo3d.STATUS.PREPARING, null, db);

    imageTo3d.generateProduct3DModel(id, imagePaths, db, { productName: product.product_name })
        .then(async (result) => {
            if (result.success) {
                await db.run(`
                    INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
                    VALUES (?, '3D_MODEL_GENERATED', 'PRODUCT', ?, ?)
                `, [req.authUser.user_id, String(id), `3D model generated for ${product.product_name}`]);
            }
        })
        .catch(err => console.error(`[3D Async Error] Product ${id}:`, err.message));

    res.status(202).json({
        success: true,
        message: '3D generation started',
        status: imageTo3d.getProduct3DStatus(id)
    });
});

app.get('/api/admin/products/:id/3d-status', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const product = await db.get('SELECT product_id, product_name, glb_url, enable_3d, generation_status_3d FROM products WHERE product_id = ?', [id]);
    if (!product) return res.status(404).json({ success: false, error: 'Product not found' });

    let status = imageTo3d.getProduct3DStatus(id);
    if (status.status === imageTo3d.STATUS.IDLE && product.generation_status_3d && product.generation_status_3d !== 'none') {
        status = {
            productId: id,
            status: product.generation_status_3d,
            progress: product.generation_status_3d === 'ready' ? 100 : 0,
            message: product.generation_status_3d === 'ready' ? '3D model ready.' : 'No 3D model generated yet',
            glbUrl: product.glb_url,
            enable3d: product.enable_3d,
            updatedAt: Date.now()
        };
    } else {
        status.enable3d = product.enable_3d;
        if (!status.glbUrl && product.glb_url) status.glbUrl = product.glb_url;
    }

    res.json({ success: true, status });
});

app.post('/api/admin/products/:id/toggle-3d', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const enable = req.body.enable_3d === true || req.body.enable_3d === 1 || req.body.enable === true;
    const result = await imageTo3d.toggleProduct3D(id, enable, db);

    await db.run(`
        INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
        VALUES (?, '3D_MODEL_TOGGLED', 'PRODUCT', ?, ?)
    `, [req.authUser.user_id, String(id), `3D display set to ${enable ? 'enabled' : 'disabled'} for product ID ${id}`]);

    res.json({ success: true, enable_3d: result.enable_3d });
});

app.delete('/api/admin/products/:id/3d-model', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const result = await imageTo3d.deleteProduct3DModel(id, db);

    await db.run(`
        INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
        VALUES (?, '3D_MODEL_DELETED', 'PRODUCT', ?, ?)
    `, [req.authUser.user_id, String(id), `3D model deleted for product ID ${id}`]);

    res.json({ success: true, message: result.message });
});

app.get('/api/admin/settings/auto-generate-3d', requireAdmin, async (req, res) => {
    const row = await db.get("SELECT setting_value FROM app_settings WHERE setting_key = 'auto_generate_3d'");
    const enabled = row ? (row.setting_value === 'on' || row.setting_value === '1') : false;
    res.json({ success: true, enabled });
});

app.post('/api/admin/settings/auto-generate-3d', requireAdmin, async (req, res) => {
    const val = (req.body.enabled === true || req.body.enabled === 'on' || req.body.enabled === 1) ? 'on' : 'off';
    if (db.isPostgres) {
        await db.run(`
            INSERT INTO app_settings (setting_key, setting_value, updated_at)
            VALUES ('auto_generate_3d', ?, CURRENT_TIMESTAMP)
            ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP
        `, [val]);
    } else {
        await db.run(`
            INSERT INTO app_settings (setting_key, setting_value, updated_at)
            VALUES ('auto_generate_3d', ?, CURRENT_TIMESTAMP)
            ON CONFLICT (setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
        `, [val]);
    }
    res.json({ success: true, enabled: val === 'on' });
});

// -------------------------------------------------------------
// 8. STATIC FRONTEND SERVING (DEVELOPMENT / LOCAL INTEGRATED MODE)
// -------------------------------------------------------------
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
if (fs.existsSync(FRONTEND_DIR)) {
    app.use(express.static(FRONTEND_DIR));
    app.get('/', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));
    app.get(['/admin', '/admin.html'], (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'admin.html')));
}

// Fallback error handler
app.use((err, req, res, next) => {
    console.error('[API Error]:', err);
    res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
});

// -------------------------------------------------------------
// Server Start
// -------------------------------------------------------------
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`====================================================`);
        console.log(`🚀 Pop Carty Production API Server Running on port ${PORT}`);
        console.log(`   Health Check: http://localhost:${PORT}/api/health`);
        console.log(`   Database: ${db.isPostgres ? 'PostgreSQL (Cloud Managed)' : 'SQLite WAL (Local Development)'}`);
        console.log(`   Default Admin: ${process.env.DEFAULT_ADMIN_EMAIL || 'admin@popcarty.com'} / PopCarty@2026!`);
        console.log(`====================================================`);
    });
}

module.exports = app;
