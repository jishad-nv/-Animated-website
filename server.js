/**
 * Pop Carty - Backend REST API Server
 * Built with Node.js native http, crypto, fs, path & SQLite database.
 * No external dependencies required.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, hashPassword, verifyPassword } = require('./db.js');

// Load .env if present (zero-dependency)
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
                if (!process.env[key]) {
                    process.env[key] = val;
                }
            }
        }
    } catch (e) {
        console.warn('Could not read .env file:', e.message);
    }
}

const imageTo3d = require('./image_to_3d.js');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'popcarty_ultra_secure_production_secret_2026';

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, 'assets', 'products', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Allowed image extensions and MIME magic bytes
const ALLOWED_IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB per file
const MAX_UPLOAD_BODY = 30 * 1024 * 1024; // 30MB total body (multiple files)

// Magic byte signatures for image validation
const MAGIC_BYTES = {
    jpg: [0xFF, 0xD8, 0xFF],
    png: [0x89, 0x50, 0x4E, 0x47],
    webp_riff: [0x52, 0x49, 0x46, 0x46] // RIFF header, WEBP checked further
};

function validateImageMagicBytes(buffer, ext) {
    if (buffer.length < 12) return false;
    if (ext === '.jpg' || ext === '.jpeg') {
        return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
    }
    if (ext === '.png') {
        return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
    }
    if (ext === '.webp') {
        return buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
            && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
    }
    return false;
}

/**
 * Parse multipart/form-data request body (no external deps)
 * Returns array of { fieldName, fileName, contentType, data: Buffer }
 */
function parseMultipartBody(req) {
    return new Promise((resolve, reject) => {
        const contentType = req.headers['content-type'] || '';
        const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
        if (!boundaryMatch) return reject(new Error('Missing multipart boundary'));
        const boundary = boundaryMatch[1] || boundaryMatch[2];
        const delimiter = Buffer.from('--' + boundary);
        const closeDelimiter = Buffer.from('--' + boundary + '--');

        const chunks = [];
        let totalSize = 0;

        req.on('data', chunk => {
            totalSize += chunk.length;
            if (totalSize > MAX_UPLOAD_BODY) {
                req.destroy();
                return reject(new Error('Upload payload too large'));
            }
            chunks.push(chunk);
        });

        req.on('end', () => {
            try {
                const fullBody = Buffer.concat(chunks);
                const parts = [];
                let pos = 0;

                // Find each part separated by delimiter
                while (pos < fullBody.length) {
                    const delimStart = fullBody.indexOf(delimiter, pos);
                    if (delimStart === -1) break;

                    const afterDelim = delimStart + delimiter.length;
                    // Check for closing delimiter
                    if (fullBody[afterDelim] === 0x2D && fullBody[afterDelim + 1] === 0x2D) break;

                    // Skip CRLF after delimiter
                    let headerStart = afterDelim;
                    if (fullBody[headerStart] === 0x0D && fullBody[headerStart + 1] === 0x0A) {
                        headerStart += 2;
                    }

                    // Find end of headers (double CRLF)
                    const headerEnd = fullBody.indexOf(Buffer.from('\r\n\r\n'), headerStart);
                    if (headerEnd === -1) { pos = afterDelim + 2; continue; }

                    const headerStr = fullBody.subarray(headerStart, headerEnd).toString('utf8');
                    const dataStart = headerEnd + 4;

                    // Find next delimiter
                    const nextDelim = fullBody.indexOf(delimiter, dataStart);
                    if (nextDelim === -1) break;

                    // Data ends 2 bytes before next delimiter (CRLF)
                    let dataEnd = nextDelim - 2;
                    if (dataEnd < dataStart) dataEnd = dataStart;
                    const data = fullBody.subarray(dataStart, dataEnd);

                    // Parse headers
                    const nameMatch = headerStr.match(/name="([^"]+)"/);
                    const fileNameMatch = headerStr.match(/filename="([^"]+)"/);
                    const ctMatch = headerStr.match(/Content-Type:\s*(.+)/i);

                    parts.push({
                        fieldName: nameMatch ? nameMatch[1] : 'unknown',
                        fileName: fileNameMatch ? fileNameMatch[1] : null,
                        contentType: ctMatch ? ctMatch[1].trim() : null,
                        data: data
                    });

                    pos = nextDelim;
                }

                resolve(parts);
            } catch (err) {
                reject(err);
            }
        });

        req.on('error', reject);
    });
}

// MIME types for static asset serving
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json'
};

// Token helpers (HMAC-SHA256 based stateless session tokens)
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

// Parse request body helper
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 5 * 1024 * 1024) { // 5MB limit
                req.destroy();
                reject(new Error('Payload too large'));
            }
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch {
                resolve({});
            }
        });
        req.on('error', reject);
    });
}

// Standard JSON response helper
function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
    res.end(JSON.stringify(data));
}

// Standard Error response helper
function sendError(res, statusCode, message) {
    sendJson(res, statusCode, { error: message, success: false });
}

// Authentication middleware
function getAuthUser(req) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return null;
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    return verifyToken(token);
}

// Main HTTP Server
const server = http.createServer(async (req, res) => {
    // Enable CORS for all API calls
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;
    const query = parsedUrl.searchParams;

    try {
        // ==========================================
        // 1. AUTHENTICATION APIS
        // ==========================================
        if (pathname === '/api/auth/register' && req.method === 'POST') {
            const body = await parseBody(req);
            const { name, email, phone, password } = body;

            if (!name || !email || !password) {
                return sendError(res, 400, 'Name, email, and password are required.');
            }

            const cleanEmail = email.trim().toLowerCase();
            const existing = db.prepare('SELECT user_id FROM users WHERE email = ?').get(cleanEmail);
            if (existing) {
                return sendError(res, 409, 'An account with this email already exists.');
            }

            const passwordHash = hashPassword(password);
            const result = db.prepare(`
                INSERT INTO users (name, email, phone, password_hash, role)
                VALUES (?, ?, ?, ?, 'customer')
            `).run(name.trim(), cleanEmail, phone ? phone.trim() : null, passwordHash);

            const userId = result.lastInsertRowid;
            const token = generateToken({ user_id: userId, email: cleanEmail, role: 'customer' });

            return sendJson(res, 201, {
                success: true,
                message: 'Account created successfully',
                token,
                user: { user_id: userId, name: name.trim(), email: cleanEmail, phone, role: 'customer' }
            });
        }

        if (pathname === '/api/auth/login' && req.method === 'POST') {
            const body = await parseBody(req);
            const { email, password } = body;

            if (!email || !password) {
                return sendError(res, 400, 'Email and password are required.');
            }

            const cleanEmail = email.trim().toLowerCase();
            const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

            if (!user || !verifyPassword(password, user.password_hash)) {
                return sendError(res, 401, 'Invalid email or password.');
            }

            const token = generateToken({ user_id: user.user_id, email: user.email, role: user.role });

            return sendJson(res, 200, {
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
        }

        if (pathname === '/api/auth/me' && req.method === 'GET') {
            const auth = getAuthUser(req);
            if (!auth) return sendError(res, 401, 'Unauthorized');

            const user = db.prepare('SELECT user_id, name, email, phone, role, created_at FROM users WHERE user_id = ?').get(auth.user_id);
            if (!user) return sendError(res, 404, 'User not found');

            return sendJson(res, 200, { success: true, user });
        }

        // ==========================================
        // 2. PRODUCTS APIS (CUSTOMER & PUBLIC)
        // ==========================================
        if (pathname === '/api/products' && req.method === 'GET') {
            const category = query.get('category');
            const search = query.get('search');
            const featured = query.get('featured');
            const bestseller = query.get('bestseller');

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
            const rows = db.prepare(sql).all(...params);

            // Parse JSON fields and strictly guard 3D enablement for customers
            const products = rows.map(r => {
                const hasValidGlb = !!(r.glb_url && r.generation_status_3d === 'ready' && fs.existsSync(path.join(__dirname, r.glb_url.replace(/^[/\\]+/, ''))));
                return {
                    ...r,
                    model_3d: r.model_3d || 'auto',
                    glb_url: hasValidGlb ? r.glb_url : null,
                    enable_3d: hasValidGlb ? 1 : 0,
                    generation_status_3d: hasValidGlb ? 'ready' : 'none',
                    images: r.images ? JSON.parse(r.images) : [],
                    variants: r.variants ? JSON.parse(r.variants) : [],
                    colors: r.colors ? JSON.parse(r.colors) : [],
                    specifications: r.specifications ? JSON.parse(r.specifications) : {}
                };
            });

            return sendJson(res, 200, { success: true, count: products.length, products });
        }

        if (pathname.startsWith('/api/products/') && req.method === 'GET') {
            const id = parseInt(pathname.replace('/api/products/', ''), 10);
            if (isNaN(id)) return sendError(res, 400, 'Invalid product ID');

            const row = db.prepare('SELECT * FROM products WHERE product_id = ? AND active = 1').get(id);
            if (!row) return sendError(res, 404, 'Product not found');

            const hasValidGlb = !!(row.glb_url && row.generation_status_3d === 'ready' && fs.existsSync(path.join(__dirname, row.glb_url.replace(/^[/\\]+/, ''))));
            const product = {
                ...row,
                model_3d: row.model_3d || 'auto',
                glb_url: hasValidGlb ? row.glb_url : null,
                enable_3d: hasValidGlb ? 1 : 0,
                generation_status_3d: hasValidGlb ? 'ready' : 'none',
                images: row.images ? JSON.parse(row.images) : [],
                variants: row.variants ? JSON.parse(row.variants) : [],
                colors: row.colors ? JSON.parse(row.colors) : [],
                specifications: row.specifications ? JSON.parse(row.specifications) : {}
            };

            return sendJson(res, 200, { success: true, product });
        }

        if (pathname === '/api/categories' && req.method === 'GET') {
            const categories = db.prepare('SELECT * FROM categories ORDER BY category_id ASC').all();
            return sendJson(res, 200, { success: true, categories });
        }

        // ==========================================
        // 3. CART APIS (PERSISTENT BACKEND)
        // ==========================================
        if (pathname === '/api/cart' && req.method === 'GET') {
            const auth = getAuthUser(req);
            const userId = auth ? auth.user_id : 2; // Default to demo shopper if guest for smooth checkout

            const items = db.prepare(`
                SELECT c.cart_item_id, c.user_id, c.product_id, c.quantity, c.selected_variant, 
                       c.selected_color, c.price, c.created_at,
                       p.product_name, p.SKU, p.thumbnail, p.stock, p.category, p.discount_price
                FROM cart_items c
                JOIN products p ON c.product_id = p.product_id
                WHERE c.user_id = ?
                ORDER BY c.created_at DESC
            `).all(userId);

            const total = items.reduce((acc, item) => acc + item.price * item.quantity, 0);

            return sendJson(res, 200, { success: true, items, total, count: items.length });
        }

        if (pathname === '/api/cart/items' && req.method === 'POST') {
            const auth = getAuthUser(req);
            const userId = auth ? auth.user_id : 2;
            const body = await parseBody(req);
            const { product_id, quantity = 1, selected_variant, selected_color } = body;

            if (!product_id) return sendError(res, 400, 'Product ID is required');

            const product = db.prepare('SELECT * FROM products WHERE product_id = ? AND active = 1').get(product_id);
            if (!product) return sendError(res, 404, 'Product not found');
            if (product.stock <= 0) return sendError(res, 400, 'Product is out of stock');

            const unitPrice = product.discount_price || product.price;

            // Check if item with same variant and color already in cart
            const existing = db.prepare(`
                SELECT cart_item_id, quantity FROM cart_items
                WHERE user_id = ? AND product_id = ? 
                  AND (selected_variant = ? OR (selected_variant IS NULL AND ? IS NULL))
                  AND (selected_color = ? OR (selected_color IS NULL AND ? IS NULL))
            `).get(userId, product_id, selected_variant || null, selected_variant || null, selected_color || null, selected_color || null);

            if (existing) {
                const newQty = existing.quantity + quantity;
                if (newQty > product.stock) {
                    return sendError(res, 400, `Cannot add more. Only ${product.stock} items in stock.`);
                }
                db.prepare('UPDATE cart_items SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE cart_item_id = ?')
                    .run(newQty, existing.cart_item_id);
            } else {
                db.prepare(`
                    INSERT INTO cart_items (user_id, product_id, quantity, selected_variant, selected_color, price)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(userId, product_id, quantity, selected_variant || null, selected_color || null, unitPrice);
            }

            return sendJson(res, 200, { success: true, message: 'Item added to Pop Carty' });
        }

        if (pathname.startsWith('/api/cart/items/') && req.method === 'PUT') {
            const auth = getAuthUser(req);
            const userId = auth ? auth.user_id : 2;
            const cartItemId = parseInt(pathname.replace('/api/cart/items/', ''), 10);
            const body = await parseBody(req);
            const { quantity } = body;

            if (quantity <= 0) {
                db.prepare('DELETE FROM cart_items WHERE cart_item_id = ? AND user_id = ?').run(cartItemId, userId);
                return sendJson(res, 200, { success: true, message: 'Item removed from cart' });
            }

            const item = db.prepare(`
                SELECT c.*, p.stock FROM cart_items c 
                JOIN products p ON c.product_id = p.product_id 
                WHERE c.cart_item_id = ? AND c.user_id = ?
            `).get(cartItemId, userId);

            if (!item) return sendError(res, 404, 'Cart item not found');
            if (quantity > item.stock) return sendError(res, 400, `Stock limit reached. Max available: ${item.stock}`);

            db.prepare('UPDATE cart_items SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE cart_item_id = ?')
                .run(quantity, cartItemId);

            return sendJson(res, 200, { success: true, message: 'Cart quantity updated' });
        }

        if (pathname.startsWith('/api/cart/items/') && req.method === 'DELETE') {
            const auth = getAuthUser(req);
            const userId = auth ? auth.user_id : 2;
            const cartItemId = parseInt(pathname.replace('/api/cart/items/', ''), 10);

            db.prepare('DELETE FROM cart_items WHERE cart_item_id = ? AND user_id = ?').run(cartItemId, userId);
            return sendJson(res, 200, { success: true, message: 'Item removed from cart' });
        }

        if (pathname === '/api/cart' && req.method === 'DELETE') {
            const auth = getAuthUser(req);
            const userId = auth ? auth.user_id : 2;

            db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(userId);
            return sendJson(res, 200, { success: true, message: 'Cart cleared' });
        }

        // ==========================================
        // 4. WISHLIST APIS (PERSISTENT BACKEND)
        // ==========================================
        if (pathname === '/api/wishlist' && req.method === 'GET') {
            const auth = getAuthUser(req);
            const userId = auth ? auth.user_id : 2;

            const items = db.prepare(`
                SELECT w.wishlist_id, w.created_at, p.*
                FROM wishlist w
                JOIN products p ON w.product_id = p.product_id
                WHERE w.user_id = ? AND p.active = 1
                ORDER BY w.created_at DESC
            `).all(userId);

            const productIds = items.map(i => i.product_id);
            return sendJson(res, 200, { success: true, count: items.length, productIds, items });
        }

        if (pathname === '/api/wishlist' && req.method === 'POST') {
            const auth = getAuthUser(req);
            const userId = auth ? auth.user_id : 2;
            const body = await parseBody(req);
            const { product_id } = body;

            if (!product_id) return sendError(res, 400, 'Product ID is required');

            const existing = db.prepare('SELECT wishlist_id FROM wishlist WHERE user_id = ? AND product_id = ?')
                .get(userId, product_id);

            let inWishlist = false;
            if (existing) {
                db.prepare('DELETE FROM wishlist WHERE wishlist_id = ?').run(existing.wishlist_id);
                inWishlist = false;
            } else {
                db.prepare('INSERT INTO wishlist (user_id, product_id) VALUES (?, ?)').run(userId, product_id);
                inWishlist = true;
            }

            const count = db.prepare('SELECT COUNT(*) as count FROM wishlist WHERE user_id = ?').get(userId).count;

            return sendJson(res, 200, {
                success: true,
                inWishlist,
                wishlistCount: count,
                message: inWishlist ? 'Saved to Wishlist' : 'Removed from Wishlist'
            });
        }

        // ==========================================
        // 5. ADDRESSES APIS
        // ==========================================
        if (pathname === '/api/addresses' && req.method === 'GET') {
            const auth = getAuthUser(req);
            const userId = auth ? auth.user_id : 2;

            const addresses = db.prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC')
                .all(userId);

            return sendJson(res, 200, { success: true, addresses });
        }

        if (pathname === '/api/addresses' && req.method === 'POST') {
            const auth = getAuthUser(req);
            const userId = auth ? auth.user_id : 2;
            const body = await parseBody(req);

            const {
                full_name, phone, house_name, house_number, street, area,
                city, district, state, country = 'Saudi Arabia', pincode, landmark,
                address_type = 'Home', is_default = 0
            } = body;

            if (!full_name || !phone || !street || !city || !state || !pincode) {
                return sendError(res, 400, 'Full name, phone, street, city, state, and pincode are required');
            }

            if (is_default) {
                db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(userId);
            }

            const resInsert = db.prepare(`
                INSERT INTO addresses (
                    user_id, full_name, phone, house_name, house_number, street, area,
                    city, district, state, country, pincode, landmark, address_type, is_default
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                userId, full_name.trim(), phone.trim(), house_name || null, house_number || null,
                street.trim(), area || null, city.trim(), district || null, state.trim(),
                country.trim(), pincode.trim(), landmark || null, address_type, is_default ? 1 : 0
            );

            return sendJson(res, 201, {
                success: true,
                address_id: resInsert.lastInsertRowid,
                message: 'Address saved successfully'
            });
        }

        // ==========================================
        // 6. ORDERS APIS (CHECKOUT & ORDER HISTORY)
        // ==========================================
        if (pathname === '/api/orders' && req.method === 'POST') {
            const auth = getAuthUser(req);
            const userId = auth ? auth.user_id : 2;
            const body = await parseBody(req);

            const {
                items,
                shipping_address,
                payment_method = 'COD',
                discount_code
            } = body;

            // Fetch items from DB cart or from payload
            let orderItems = items;
            if (!orderItems || orderItems.length === 0) {
                orderItems = db.prepare(`
                    SELECT c.product_id, c.quantity, c.selected_variant, c.selected_color,
                           p.product_name, p.SKU, p.thumbnail as product_image, p.price, p.discount_price, p.stock
                    FROM cart_items c
                    JOIN products p ON c.product_id = p.product_id
                    WHERE c.user_id = ?
                `).all(userId);
            }

            if (!orderItems || orderItems.length === 0) {
                return sendError(res, 400, 'Cannot place order: Cart is empty');
            }

            if (!shipping_address || !shipping_address.full_name || !shipping_address.street || !shipping_address.city) {
                return sendError(res, 400, 'Valid shipping address is required');
            }

            // Verify stock availability for all items
            for (const item of orderItems) {
                const p = db.prepare('SELECT stock, product_name FROM products WHERE product_id = ?').get(item.product_id);
                if (!p || p.stock < item.quantity) {
                    return sendError(res, 400, `Insufficient stock for "${p ? p.product_name : 'Item'}". Available: ${p ? p.stock : 0}`);
                }
            }

            // Calculate totals
            let subtotal = 0;
            const processedItems = orderItems.map(item => {
                const unitPrice = item.discount_price || item.price || item.unit_price;
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

            // Discount calculation
            let discount = 0;
            if (discount_code && discount_code.toUpperCase() === 'POPCART10') {
                discount = Math.round(subtotal * 0.10 * 100) / 100;
            }

            const delivery_charge = subtotal > 50 ? 0.00 : 15.00;
            const taxable = subtotal - discount;
            const tax = Math.round(taxable * 0.15 * 100) / 100; // 15% VAT
            const total_amount = Math.round((taxable + delivery_charge + tax) * 100) / 100;

            // Generate unique human readable order number: POP-2026-00000X
            const nextOrderCount = db.prepare('SELECT COUNT(*) as count FROM orders').get().count + 1;
            const order_number = `POP-2026-${String(nextOrderCount).padStart(6, '0')}`;

            const now = new Date();
            const order_date = now.toISOString().split('T')[0];
            const order_time = now.toTimeString().split(' ')[0];

            // IMMUTABLE HISTORICAL SNAPSHOT of shipping address
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

            // TRANSACTION EXECUTION
            const orderInsert = db.prepare(`
                INSERT INTO orders (
                    order_number, user_id, order_date, order_time, subtotal, discount,
                    delivery_charge, tax, total_amount, payment_method, payment_status,
                    order_status, shipping_address_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Confirmed', ?)
            `).run(
                order_number, userId, order_date, order_time, subtotal, discount,
                delivery_charge, tax, total_amount, payment_method, payment_status,
                shipping_address_json
            );

            const order_id = orderInsert.lastInsertRowid;

            // Insert each order item and decrement stock
            const itemStmt = db.prepare(`
                INSERT INTO order_items (
                    order_id, product_id, product_name, SKU, product_image, quantity,
                    unit_price, discount, final_price, selected_variant, selected_color
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const stockStmt = db.prepare(`
                UPDATE products 
                SET stock = MAX(0, stock - ?), updated_at = CURRENT_TIMESTAMP 
                WHERE product_id = ?
            `);

            for (const pi of processedItems) {
                itemStmt.run(
                    order_id, pi.product_id, pi.product_name, pi.SKU, pi.product_image,
                    pi.quantity, pi.unit_price, pi.discount, pi.final_price,
                    pi.selected_variant, pi.selected_color
                );
                stockStmt.run(pi.quantity, pi.product_id);
            }

            // Create payment record
            const txnId = payment_method === 'Online'
                ? `TXN_${Date.now()}_${Math.floor(Math.random() * 100000)}`
                : `COD_REF_${order_number}`;

            db.prepare(`
                INSERT INTO payments (order_id, payment_method, payment_status, transaction_id, amount)
                VALUES (?, ?, ?, ?, ?)
            `).run(order_id, payment_method, payment_status, txnId, total_amount);

            // Clear persistent cart for user
            db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(userId);

            // Audit log
            db.prepare(`
                INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
                VALUES (?, 'ORDER_CREATED', 'ORDER', ?, ?)
            `).run(userId, order_number, `Order placed with ${processedItems.length} items. Total: ${total_amount} SAR via ${payment_method}`);

            return sendJson(res, 201, {
                success: true,
                message: 'Order placed successfully',
                order_id,
                order_number,
                total_amount,
                payment_status,
                order_status: 'Confirmed'
            });
        }

        if (pathname === '/api/orders' && req.method === 'GET') {
            const auth = getAuthUser(req);
            const userId = auth ? auth.user_id : 2;

            const orders = db.prepare(`
                SELECT * FROM orders WHERE user_id = ? ORDER BY order_id DESC
            `).all(userId);

            const enriched = orders.map(o => {
                const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.order_id);
                return {
                    ...o,
                    shipping_address: JSON.parse(o.shipping_address_json),
                    items
                };
            });

            return sendJson(res, 200, { success: true, count: enriched.length, orders: enriched });
        }

        if (pathname.startsWith('/api/orders/') && req.method === 'GET') {
            const auth = getAuthUser(req);
            const userId = auth ? auth.user_id : 2;
            const orderId = parseInt(pathname.replace('/api/orders/', ''), 10);

            const order = db.prepare('SELECT * FROM orders WHERE order_id = ? AND user_id = ?').get(orderId, userId);
            if (!order) return sendError(res, 404, 'Order not found');

            const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.order_id);
            const payment = db.prepare('SELECT * FROM payments WHERE order_id = ?').get(order.order_id);

            return sendJson(res, 200, {
                success: true,
                order: {
                    ...order,
                    shipping_address: JSON.parse(order.shipping_address_json),
                    items,
                    payment
                }
            });
        }

        // ==========================================
        // 7. SECURE ADMIN BACKEND APIS (ROLE: ADMIN)
        // ==========================================
        if (pathname.startsWith('/api/admin/')) {
            const auth = getAuthUser(req);
            if (!auth || auth.role !== 'admin') {
                return sendError(res, 403, 'Forbidden: Admin authorization required');
            }

            // Image Upload: POST /api/admin/upload
            if (pathname === '/api/admin/upload' && req.method === 'POST') {
                try {
                    const parts = await parseMultipartBody(req);
                    const fileParts = parts.filter(p => p.fileName && p.data && p.data.length > 0);

                    if (fileParts.length === 0) {
                        return sendError(res, 400, 'No image files received');
                    }

                    const savedUrls = [];
                    const errors = [];

                    for (const part of fileParts) {
                        const ext = path.extname(part.fileName).toLowerCase();

                        // Validate extension
                        if (!ALLOWED_IMAGE_EXTS.includes(ext)) {
                            errors.push(`${part.fileName}: Invalid file type. Allowed: JPG, JPEG, PNG, WEBP`);
                            continue;
                        }

                        // Validate file size
                        if (part.data.length > MAX_UPLOAD_SIZE) {
                            errors.push(`${part.fileName}: File too large. Maximum 5MB per image`);
                            continue;
                        }

                        // Validate magic bytes
                        if (!validateImageMagicBytes(part.data, ext)) {
                            errors.push(`${part.fileName}: File content does not match expected image format`);
                            continue;
                        }

                        // Generate unique filename
                        const uniqueId = crypto.randomBytes(8).toString('hex');
                        const safeName = `upload_${Date.now()}_${uniqueId}${ext}`;
                        const savePath = path.join(UPLOADS_DIR, safeName);

                        // Security: ensure path stays within uploads dir
                        const normalizedPath = path.normalize(savePath);
                        if (!normalizedPath.startsWith(UPLOADS_DIR)) {
                            errors.push(`${part.fileName}: Invalid file path`);
                            continue;
                        }

                        fs.writeFileSync(normalizedPath, part.data);
                        const publicUrl = `/assets/products/uploads/${safeName}`;
                        savedUrls.push(publicUrl);
                    }

                    if (savedUrls.length === 0 && errors.length > 0) {
                        return sendError(res, 400, errors.join('; '));
                    }

                    db.prepare(`
                        INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
                        VALUES (?, 'IMAGE_UPLOADED', 'PRODUCT', ?, ?)
                    `).run(auth.user_id, 'upload', `Admin uploaded ${savedUrls.length} image(s)`);

                    return sendJson(res, 201, {
                        success: true,
                        urls: savedUrls,
                        errors: errors.length > 0 ? errors : undefined,
                        message: `${savedUrls.length} image(s) uploaded successfully`
                    });
                } catch (err) {
                    console.error('Upload error:', err);
                    return sendError(res, 500, `Upload failed: ${err.message}`);
                }
            }

            // Image Delete: DELETE /api/admin/upload
            if (pathname === '/api/admin/upload' && req.method === 'DELETE') {
                const body = await parseBody(req);
                const { url } = body;

                if (!url) return sendError(res, 400, 'Image URL is required');

                // Only allow deleting files in the uploads directory
                if (!url.startsWith('/assets/products/uploads/')) {
                    return sendError(res, 403, 'Cannot delete non-uploaded images. Only uploaded images can be removed from storage.');
                }

                const fileName = path.basename(url);
                const filePath = path.join(UPLOADS_DIR, fileName);
                const normalizedPath = path.normalize(filePath);

                // Security: path traversal protection
                if (!normalizedPath.startsWith(UPLOADS_DIR)) {
                    return sendError(res, 403, 'Forbidden: Invalid file path');
                }

                if (fs.existsSync(normalizedPath)) {
                    fs.unlinkSync(normalizedPath);
                }

                db.prepare(`
                    INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
                    VALUES (?, 'IMAGE_DELETED', 'PRODUCT', ?, ?)
                `).run(auth.user_id, fileName, `Admin deleted uploaded image: ${fileName}`);

                return sendJson(res, 200, { success: true, message: 'Image deleted successfully' });
            }

            // Dashboard Overview Statistics
            if (pathname === '/api/admin/dashboard' && req.method === 'GET') {
                const totalProducts = db.prepare('SELECT COUNT(*) as count FROM products WHERE active = 1').get().count;
                const totalCustomers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'customer'").get().count;
                const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
                const pendingOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE order_status IN ('Pending', 'Processing')").get().count;
                const completedOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE order_status = 'Delivered'").get().count;
                const cancelledOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE order_status = 'Cancelled'").get().count;
                const totalSalesRow = db.prepare("SELECT SUM(total_amount) as total FROM orders WHERE payment_status = 'Paid'").get();
                const totalSales = totalSalesRow ? (totalSalesRow.total || 0) : 0;
                const lowStockProducts = db.prepare('SELECT COUNT(*) as count FROM products WHERE stock <= 5 AND active = 1').get().count;

                const recentOrders = db.prepare(`
                    SELECT o.order_id, o.order_number, o.order_date, o.total_amount, o.order_status, o.payment_status,
                           u.name as customer_name, u.email as customer_email
                    FROM orders o
                    JOIN users u ON o.user_id = u.user_id
                    ORDER BY o.order_id DESC LIMIT 6
                `).all();

                return sendJson(res, 200, {
                    success: true,
                    stats: {
                        totalProducts,
                        totalCustomers,
                        totalOrders,
                        pendingOrders,
                        completedOrders,
                        cancelledOrders,
                        totalSales: Math.round(totalSales * 100) / 100,
                        lowStockProducts
                    },
                    recentOrders
                });
            }

            // Product Management: List All
            if (pathname === '/api/admin/products' && req.method === 'GET') {
                const search = query.get('search');
                let sql = 'SELECT * FROM products';
                const params = [];

                if (search) {
                    sql += ' WHERE product_name LIKE ? OR SKU LIKE ? OR category LIKE ?';
                    const term = `%${search.trim()}%`;
                    params.push(term, term, term);
                }
                sql += ' ORDER BY product_id DESC';

                const products = db.prepare(sql).all(...params).map(p => ({
                    ...p,
                    model_3d: p.model_3d || 'auto',
                    glb_url: p.glb_url || null,
                    enable_3d: p.enable_3d !== undefined ? p.enable_3d : 0,
                    generation_status_3d: p.generation_status_3d || 'none',
                    images: p.images ? JSON.parse(p.images) : [],
                    variants: p.variants ? JSON.parse(p.variants) : [],
                    colors: p.colors ? JSON.parse(p.colors) : [],
                    specifications: p.specifications ? JSON.parse(p.specifications) : {}
                }));

                return sendJson(res, 200, { success: true, count: products.length, products });
            }

            // Product Management: Get Single Product (Admin, active or inactive)
            if (pathname.startsWith('/api/admin/products/') && req.method === 'GET' && !pathname.includes('/3d-status')) {
                const id = parseInt(pathname.replace('/api/admin/products/', ''), 10);
                if (isNaN(id)) return sendError(res, 400, 'Invalid product ID');

                const row = db.prepare('SELECT * FROM products WHERE product_id = ?').get(id);
                if (!row) return sendError(res, 404, 'Product not found');

                const product = {
                    ...row,
                    model_3d: row.model_3d || 'auto',
                    glb_url: row.glb_url || null,
                    enable_3d: row.enable_3d !== undefined ? row.enable_3d : 0,
                    generation_status_3d: row.generation_status_3d || 'none',
                    images: row.images ? JSON.parse(row.images) : [],
                    variants: row.variants ? JSON.parse(row.variants) : [],
                    colors: row.colors ? JSON.parse(row.colors) : [],
                    specifications: row.specifications ? JSON.parse(row.specifications) : {}
                };

                return sendJson(res, 200, { success: true, product });
            }

            // Product Management: Add Product
            if (pathname === '/api/admin/products' && req.method === 'POST') {
                const body = await parseBody(req);
                const {
                    product_name, SKU, description, category, brand, price,
                    discount_price, discount_percentage = 0, thumbnail, images,
                    stock = 0, variants, colors, specifications, model_3d = 'auto',
                    glb_url = null, enable_3d = 0, generation_status_3d = 'none',
                    featured = 0, bestseller = 0
                } = body;

                if (!product_name || !SKU || !price || !category) {
                    return sendError(res, 400, 'Product name, SKU, price, and category are required');
                }

                const existing = db.prepare('SELECT product_id FROM products WHERE SKU = ?').get(SKU.trim());
                if (existing) return sendError(res, 409, 'SKU already exists');

                const resInsert = db.prepare(`
                    INSERT INTO products (
                        product_name, SKU, description, category, brand, price, discount_price,
                        discount_percentage, images, thumbnail, stock, variants, colors,
                        specifications, model_3d, glb_url, enable_3d, generation_status_3d, featured, bestseller, active
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                `).run(
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
                );

                db.prepare(`
                    INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
                    VALUES (?, 'PRODUCT_CREATED', 'PRODUCT', ?, ?)
                `).run(auth.user_id, SKU, `Admin added product: ${product_name}`);

                const newProductId = resInsert.lastInsertRowid;

                // Auto Generate 3D: If enabled in settings and Meshy key is present, auto-trigger
                try {
                    const autoGenRow = db.prepare("SELECT setting_value FROM app_settings WHERE setting_key = 'auto_generate_3d'").get();
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

                return sendJson(res, 201, {
                    success: true,
                    product_id: newProductId,
                    message: 'Product created successfully'
                });
            }

            // Product Management: Reactivate Product
            if (pathname.match(/^\/api\/admin\/products\/\d+\/reactivate$/) && req.method === 'POST') {
                const id = parseInt(pathname.split('/')[4], 10);
                if (isNaN(id)) return sendError(res, 400, 'Invalid product ID');

                const current = db.prepare('SELECT * FROM products WHERE product_id = ?').get(id);
                if (!current) return sendError(res, 404, 'Product not found');

                db.prepare('UPDATE products SET active = 1, updated_at = CURRENT_TIMESTAMP WHERE product_id = ?').run(id);

                db.prepare(`
                    INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
                    VALUES (?, 'PRODUCT_REACTIVATED', 'PRODUCT', ?, ?)
                `).run(auth.user_id, String(id), `Reactivated product ID: ${id}`);

                return sendJson(res, 200, { success: true, message: 'Product reactivated successfully' });
            }

            // Product Management: Edit Product
            if (pathname.match(/^\/api\/admin\/products\/\d+$/) && req.method === 'PUT') {
                const id = parseInt(pathname.replace('/api/admin/products/', ''), 10);
                const body = await parseBody(req);

                const current = db.prepare('SELECT * FROM products WHERE product_id = ?').get(id);
                if (!current) return sendError(res, 404, 'Product not found');

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

                // Handle images JSON array
                let updatedImages = current.images;
                if (body.images !== undefined) {
                    updatedImages = typeof body.images === 'string' ? body.images : JSON.stringify(body.images || []);
                }

                db.prepare(`
                    UPDATE products SET
                        product_name = ?, SKU = ?, description = ?, category = ?, brand = ?,
                        price = ?, discount_price = ?, thumbnail = ?, images = ?, stock = ?, active = ?,
                        model_3d = ?, glb_url = ?, enable_3d = ?, generation_status_3d = ?,
                        featured = ?, bestseller = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE product_id = ?
                `).run(
                    updatedName, updatedSKU, updatedDesc, updatedCategory, updatedBrand,
                    updatedPrice, updatedDiscountPrice, updatedThumb, updatedImages, updatedStock, updatedActive,
                    updatedModel3d, updatedGlbUrl, updatedEnable3d, updatedStatus3d,
                    updatedFeatured, updatedBestseller, id
                );

                db.prepare(`
                    INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
                    VALUES (?, 'PRODUCT_UPDATED', 'PRODUCT', ?, ?)
                `).run(auth.user_id, updatedSKU, `Admin updated product ${updatedName} (Stock: ${updatedStock}, Price: ${updatedPrice}, Active: ${updatedActive})`);

                return sendJson(res, 200, { success: true, message: 'Product updated successfully' });
            }

            // Product Management: Delete/Deactivate
            if (pathname.match(/^\/api\/admin\/products\/\d+$/) && req.method === 'DELETE') {
                const id = parseInt(pathname.replace('/api/admin/products/', ''), 10);
                const current = db.prepare('SELECT * FROM products WHERE product_id = ?').get(id);
                if (!current) return sendError(res, 404, 'Product not found');

                const permanent = query.get('permanent') === '1' || query.get('hard') === 'true';

                if (permanent) {
                    // Also clean up 3D model if exists
                    if (current.glb_url) {
                        try { imageTo3d.deleteProduct3DModel(id, db); } catch(e) {}
                    }
                    db.prepare('DELETE FROM products WHERE product_id = ?').run(id);
                    db.prepare(`
                        INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
                        VALUES (?, 'PRODUCT_DELETED', 'PRODUCT', ?, ?)
                    `).run(auth.user_id, String(id), `Permanently deleted product ID: ${id} (${current.product_name})`);

                    return sendJson(res, 200, { success: true, message: 'Product permanently deleted successfully' });
                } else {
                    db.prepare('UPDATE products SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE product_id = ?').run(id);

                    db.prepare(`
                        INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
                        VALUES (?, 'PRODUCT_DEACTIVATED', 'PRODUCT', ?, ?)
                    `).run(auth.user_id, String(id), `Deactivated product ID: ${id} (${current.product_name})`);

                    return sendJson(res, 200, { success: true, message: 'Product deactivated successfully' });
                }
            }

            // ==========================================
            // 7.1 AI IMAGE-TO-3D ENDPOINTS
            // ==========================================

            // Trigger 3D Generation: POST /api/admin/products/:id/generate-3d
            if (pathname.match(/^\/api\/admin\/products\/\d+\/generate-3d$/) && req.method === 'POST') {
                const id = parseInt(pathname.split('/')[4], 10);
                if (isNaN(id)) return sendError(res, 400, 'Invalid product ID');

                const product = db.prepare('SELECT * FROM products WHERE product_id = ?').get(id);
                if (!product) return sendError(res, 404, 'Product not found');

                // Check API key first
                const meshyKey = process.env.MESHY_API_KEY ? process.env.MESHY_API_KEY.trim() : '';
                if (!meshyKey) {
                    const missingMsg = 'AI 3D generation requires a Meshy API key.';
                    imageTo3d.setProduct3DStatus(id, imageTo3d.STATUS.FAILED, 0, missingMsg);
                    imageTo3d.syncStatusToDb(id, imageTo3d.STATUS.FAILED, null, db);
                    return sendError(res, 400, missingMsg);
                }

                const body = await parseBody(req);

                // Collect up to 4 images automatically from existing product in DB
                let imagePaths = [];
                if (Array.isArray(body.image_paths) && body.image_paths.length > 0) {
                    imagePaths = body.image_paths;
                } else {
                    if (product.thumbnail) imagePaths.push(product.thumbnail);
                    if (product.images) {
                        try {
                            const parsedImages = JSON.parse(product.images);
                            if (Array.isArray(parsedImages)) {
                                for (const img of parsedImages) {
                                    if (img && !imagePaths.includes(img)) imagePaths.push(img);
                                }
                            }
                        } catch (e) {}
                    }
                }

                if (imagePaths.length === 0) {
                    return sendError(res, 400, 'Product has no stored images to generate 3D model from');
                }

                // Check if already generating
                const currentStatus = imageTo3d.getProduct3DStatus(id);
                if ([imageTo3d.STATUS.PREPARING, imageTo3d.STATUS.UPLOADING, imageTo3d.STATUS.SUBMITTED, imageTo3d.STATUS.GENERATING, imageTo3d.STATUS.TEXTURING, imageTo3d.STATUS.DOWNLOADING, imageTo3d.STATUS.VALIDATING].includes(currentStatus.status)) {
                    return sendJson(res, 200, {
                        success: true,
                        message: 'Generation already in progress',
                        status: currentStatus
                    });
                }

                // Set initial status and launch asynchronously
                imageTo3d.setProduct3DStatus(id, imageTo3d.STATUS.PREPARING, 10, 'Preparing image...');
                imageTo3d.syncStatusToDb(id, imageTo3d.STATUS.PREPARING, null, db);

                imageTo3d.generateProduct3DModel(id, imagePaths, db, {
                    productName: product.product_name
                }).then(result => {
                    if (result.success) {
                        db.prepare(`
                            INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
                            VALUES (?, '3D_MODEL_GENERATED', 'PRODUCT', ?, ?)
                        `).run(auth.user_id, String(id), `3D model generated for ${product.product_name} (Meshy AI, ${(result.fileSize / 1024).toFixed(0)} KB)`);
                    }
                }).catch(err => {
                    console.error(`[3D Async Error] Product ${id}:`, err.message);
                });

                return sendJson(res, 202, {
                    success: true,
                    message: '3D generation started',
                    status: imageTo3d.getProduct3DStatus(id)
                });
            }

            // Check 3D Status: GET /api/admin/products/:id/3d-status
            if (pathname.match(/^\/api\/admin\/products\/\d+\/3d-status$/) && req.method === 'GET') {
                const id = parseInt(pathname.split('/')[4], 10);
                if (isNaN(id)) return sendError(res, 400, 'Invalid product ID');

                const product = db.prepare('SELECT product_id, product_name, glb_url, enable_3d, generation_status_3d FROM products WHERE product_id = ?').get(id);
                if (!product) return sendError(res, 404, 'Product not found');

                let status = imageTo3d.getProduct3DStatus(id);
                if (status.status === imageTo3d.STATUS.IDLE && product.generation_status_3d && product.generation_status_3d !== 'none' && product.generation_status_3d !== 'idle') {
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

                return sendJson(res, 200, { success: true, status });
            }

            // Toggle 3D Display: POST /api/admin/products/:id/toggle-3d
            if (pathname.match(/^\/api\/admin\/products\/\d+\/toggle-3d$/) && req.method === 'POST') {
                const id = parseInt(pathname.split('/')[4], 10);
                if (isNaN(id)) return sendError(res, 400, 'Invalid product ID');

                const body = await parseBody(req);
                const enable = body.enable_3d === true || body.enable_3d === 1 || body.enable === true;
                const result = imageTo3d.toggleProduct3D(id, enable, db);

                db.prepare(`
                    INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
                    VALUES (?, '3D_MODEL_TOGGLED', 'PRODUCT', ?, ?)
                `).run(auth.user_id, String(id), `3D display set to ${enable ? 'enabled' : 'disabled'} for product ID ${id}`);

                return sendJson(res, 200, { success: true, enable_3d: result.enable_3d });
            }

            // Delete 3D Model: DELETE /api/admin/products/:id/3d-model
            if (pathname.match(/^\/api\/admin\/products\/\d+\/3d-model$/) && req.method === 'DELETE') {
                const id = parseInt(pathname.split('/')[4], 10);
                if (isNaN(id)) return sendError(res, 400, 'Invalid product ID');

                const result = imageTo3d.deleteProduct3DModel(id, db);

                db.prepare(`
                    INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
                    VALUES (?, '3D_MODEL_DELETED', 'PRODUCT', ?, ?)
                `).run(auth.user_id, String(id), `3D model deleted for product ID ${id}`);

                return sendJson(res, 200, { success: true, message: result.message });
            }

            // Manual GLB Upload: POST /api/admin/products/:id/upload-3d
            if (pathname.match(/^\/api\/admin\/products\/\d+\/upload-3d$/) && req.method === 'POST') {
                const id = parseInt(pathname.split('/')[4], 10);
                if (isNaN(id)) return sendError(res, 400, 'Invalid product ID');

                const product = db.prepare('SELECT product_id, product_name FROM products WHERE product_id = ?').get(id);
                if (!product) return sendError(res, 404, 'Product not found');

                const parts = await parseMultipartBody(req);
                const filePart = parts.find(p => p.fileName && p.data && p.data.length > 0);
                if (!filePart) return sendError(res, 400, 'No GLB file received');

                const ext = path.extname(filePart.fileName).toLowerCase();
                if (ext !== '.glb') return sendError(res, 400, 'Only .glb 3D files are supported');

                const result = imageTo3d.saveUploadedGlb(id, filePart.data, db);
                if (!result.success) {
                    return sendError(res, 400, result.message);
                }

                db.prepare(`
                    INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
                    VALUES (?, '3D_MODEL_MANUAL_UPLOAD', 'PRODUCT', ?, ?)
                `).run(auth.user_id, String(id), `Manual GLB uploaded for product ${product.product_name} (${Math.round(result.fileSize / 1024)} KB)`);

                return sendJson(res, 200, {
                    success: true,
                    glbUrl: result.glbUrl,
                    fileSize: result.fileSize,
                    message: result.message
                });
            }

            // Auto Generate 3D Setting: GET /api/admin/settings/auto-generate-3d
            if (pathname === '/api/admin/settings/auto-generate-3d' && req.method === 'GET') {
                const row = db.prepare("SELECT setting_value FROM app_settings WHERE setting_key = 'auto_generate_3d'").get();
                const enabled = row ? (row.setting_value === 'on' || row.setting_value === '1') : false;
                return sendJson(res, 200, { success: true, enabled });
            }

            // Auto Generate 3D Setting: POST /api/admin/settings/auto-generate-3d
            if (pathname === '/api/admin/settings/auto-generate-3d' && req.method === 'POST') {
                const body = await parseBody(req);
                const val = (body.enabled === true || body.enabled === 'on' || body.enabled === 1) ? 'on' : 'off';
                db.prepare(`
                    INSERT INTO app_settings (setting_key, setting_value, updated_at)
                    VALUES ('auto_generate_3d', ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
                `).run(val);
                return sendJson(res, 200, { success: true, enabled: val === 'on' });
            }

            // Orders Management: List & Filter
            if (pathname === '/api/admin/orders' && req.method === 'GET') {
                const status = query.get('status');
                const paymentStatus = query.get('payment_status');
                const search = query.get('search');

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
                if (paymentStatus && paymentStatus !== 'all') {
                    sql += ' AND o.payment_status = ?';
                    params.push(paymentStatus);
                }
                if (search) {
                    sql += ` AND (o.order_number LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)`;
                    const term = `%${search.trim()}%`;
                    params.push(term, term, term, term);
                }

                sql += ' ORDER BY o.order_id DESC';
                const rows = db.prepare(sql).all(...params);

                const orders = rows.map(o => {
                    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.order_id);
                    return {
                        ...o,
                        shipping_address: JSON.parse(o.shipping_address_json),
                        items
                    };
                });

                return sendJson(res, 200, { success: true, count: orders.length, orders });
            }

            // Order Details: Full Single Order Inspection
            if (pathname.startsWith('/api/admin/orders/') && !pathname.endsWith('/status') && req.method === 'GET') {
                const id = parseInt(pathname.replace('/api/admin/orders/', ''), 10);
                const order = db.prepare(`
                    SELECT o.*, u.name as customer_name, u.email as customer_email, u.phone as customer_phone, u.created_at as customer_since
                    FROM orders o
                    JOIN users u ON o.user_id = u.user_id
                    WHERE o.order_id = ?
                `).get(id);

                if (!order) return sendError(res, 404, 'Order not found');

                const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.order_id);
                const payment = db.prepare('SELECT * FROM payments WHERE order_id = ?').get(order.order_id);

                return sendJson(res, 200, {
                    success: true,
                    order: {
                        ...order,
                        shipping_address: JSON.parse(order.shipping_address_json),
                        items,
                        payment
                    }
                });
            }

            // Order Status Update
            if (pathname.startsWith('/api/admin/orders/') && pathname.endsWith('/status') && req.method === 'PUT') {
                const id = parseInt(pathname.replace('/api/admin/orders/', '').replace('/status', ''), 10);
                const body = await parseBody(req);
                const { order_status, payment_status } = body;

                if (!order_status) return sendError(res, 400, 'Order status is required');

                const validStatuses = [
                    'Pending', 'Confirmed', 'Processing', 'Packed', 'Shipped', 
                    'Out for Delivery', 'Delivered', 'Cancelled', 'Returned', 'Refunded'
                ];
                if (!validStatuses.includes(order_status)) {
                    return sendError(res, 400, `Invalid order status. Must be one of: ${validStatuses.join(', ')}`);
                }

                if (payment_status) {
                    db.prepare('UPDATE orders SET order_status = ?, payment_status = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?')
                        .run(order_status, payment_status, id);
                    db.prepare('UPDATE payments SET payment_status = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?')
                        .run(payment_status, id);
                } else {
                    db.prepare('UPDATE orders SET order_status = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?')
                        .run(order_status, id);
                }

                db.prepare(`
                    INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
                    VALUES (?, 'ORDER_STATUS_CHANGED', 'ORDER', ?, ?)
                `).run(auth.user_id, String(id), `Admin updated order ID ${id} status to: ${order_status}`);

                return sendJson(res, 200, { success: true, message: `Order status updated to ${order_status}` });
            }

            // Customer Management: List registered customers
            if (pathname === '/api/admin/users' && req.method === 'GET') {
                const users = db.prepare(`
                    SELECT u.user_id, u.name, u.email, u.phone, u.role, u.created_at,
                           COUNT(o.order_id) as total_orders,
                           COALESCE(SUM(o.total_amount), 0) as total_spent
                    FROM users u
                    LEFT JOIN orders o ON u.user_id = o.user_id
                    WHERE u.role = 'customer'
                    GROUP BY u.user_id
                    ORDER BY u.created_at DESC
                `).all();

                return sendJson(res, 200, { success: true, count: users.length, users });
            }

            // Inventory Control: Stock overview
            if (pathname === '/api/admin/inventory' && req.method === 'GET') {
                const inventory = db.prepare(`
                    SELECT product_id, product_name, SKU, category, stock, price, thumbnail,
                           CASE 
                               WHEN stock <= 0 THEN 'Out of Stock'
                               WHEN stock <= 5 THEN 'Low Stock'
                               ELSE 'In Stock'
                           END as status
                    FROM products
                    WHERE active = 1
                    ORDER BY stock ASC
                `).all();

                return sendJson(res, 200, { success: true, inventory });
            }

            // Audit Logs
            if (pathname === '/api/admin/audit-logs' && req.method === 'GET') {
                const logs = db.prepare(`
                    SELECT a.*, u.name as admin_name, u.email as admin_email
                    FROM audit_logs a
                    LEFT JOIN users u ON a.user_id = u.user_id
                    ORDER BY a.created_at DESC LIMIT 50
                `).all();

                return sendJson(res, 200, { success: true, logs });
            }
        }

        // ==========================================
        // 8. STATIC FILE SERVING
        // ==========================================
        let filePath = '';
        if (pathname === '/' || pathname === '/index.html') {
            filePath = path.join(__dirname, 'index.html');
        } else if (pathname === '/admin' || pathname === '/admin.html') {
            filePath = path.join(__dirname, 'admin.html');
        } else {
            // Strip leading slash
            const relPath = pathname.replace(/^\//, '');
            filePath = path.join(__dirname, relPath);
        }

        // Security check: ensure path stays inside project directory
        const normalized = path.normalize(filePath);
        if (!normalized.startsWith(__dirname)) {
            return sendError(res, 403, 'Forbidden');
        }

        if (fs.existsSync(normalized) && fs.statSync(normalized).isFile()) {
            const ext = path.extname(normalized).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';

            res.writeHead(200, { 'Content-Type': contentType });
            return fs.createReadStream(normalized).pipe(res);
        }

        // If not found
        sendError(res, 404, `Route or resource not found: ${pathname}`);

    } catch (err) {
        console.error('Server error handling request:', err);
        sendError(res, 500, `Internal Server Error: ${err.message}`);
    }
});

server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 Pop Carty REST API & Web Server Running on:`);
    console.log(`   Customer Store: http://localhost:${PORT}/`);
    console.log(`   Admin Dashboard: http://localhost:${PORT}/admin`);
    console.log(`   Database: data/popcarty.db (SQLite WAL mode)`);
    console.log(`   Default Admin: admin@popcarty.com / PopCarty@2026!`);
    console.log(`   Demo Shopper: shopper@popcarty.com / Customer@2026!`);
    console.log(`====================================================`);
});
