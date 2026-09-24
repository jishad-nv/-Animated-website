/**
 * Pop Carty - Universal Database Layer
 * Supports Production Managed PostgreSQL (Neon, Supabase, Render, Railway, etc.)
 * with graceful fallback to local SQLite for zero-config offline development.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load environment variables if not already loaded
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
        console.warn('[DB] Warning: Could not read .env file:', e.message);
    }
}

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
const isPostgres = !!DATABASE_URL;

let pgPool = null;
let sqliteDb = null;

// Password hashing utility using PBKDF2 (Cryptographically secure & compatible)
function hashPassword(password, salt = null) {
    if (!salt) {
        salt = crypto.randomBytes(16).toString('hex');
    }
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    if (!storedHash || typeof storedHash !== 'string') return false;
    const parts = storedHash.split(':');
    if (parts.length !== 2) return false;
    const [salt, originalHash] = parts;
    const testHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    try {
        return crypto.timingSafeEqual(Buffer.from(originalHash, 'hex'), Buffer.from(testHash, 'hex'));
    } catch {
        return false;
    }
}

/**
 * SQL Dialect Adapter Helper
 * Converts SQLite query patterns to PostgreSQL when connected to PostgreSQL.
 */
function translateSqlForPostgres(sql) {
    let converted = sql;

    // Replace SQLite MAX(0, stock - ?) with GREATEST(0, stock - $N)
    converted = converted.replace(/MAX\s*\(\s*0\s*,\s*stock\s*-\s*\?\s*\)/gi, 'GREATEST(0, stock - ?)');

    // Replace INSERT OR IGNORE INTO categories with ON CONFLICT DO NOTHING
    if (/INSERT\s+OR\s+IGNORE\s+INTO\s+categories/i.test(converted)) {
        converted = converted.replace(/INSERT\s+OR\s+IGNORE\s+INTO\s+categories/i, 'INSERT INTO categories') +
                    ' ON CONFLICT (name) DO NOTHING';
    }

    // Convert parameter placeholders ? to $1, $2, $3...
    let paramIndex = 1;
    converted = converted.replace(/\?/g, () => `$${paramIndex++}`);

    return converted;
}

/**
 * Normalize row keys to ensure consistent SKU vs sku access across engines
 */
function normalizeRow(row) {
    if (!row || typeof row !== 'object') return row;
    const normalized = { ...row };
    if (normalized.sku !== undefined && normalized.SKU === undefined) {
        normalized.SKU = normalized.sku;
    }
    return normalized;
}

// -------------------------------------------------------------
// Initialize Engine
// -------------------------------------------------------------
if (isPostgres) {
    const { Pool } = require('pg');
    const sslConfig = (process.env.PGSSLMODE === 'disable' || DATABASE_URL.includes('sslmode=disable'))
        ? false
        : { rejectUnauthorized: false };

    pgPool = new Pool({
        connectionString: DATABASE_URL,
        ssl: sslConfig,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
    });

    console.log('[DB] Connected to PostgreSQL managed database engine');
} else {
    // Local SQLite fallback with multi-version Node compatibility (Node 18/20/22/24+)
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = process.env.DATABASE_PATH
        ? path.resolve(__dirname, '..', process.env.DATABASE_PATH)
        : path.join(dataDir, 'popcarty.db');

    try {
        const { DatabaseSync } = require('node:sqlite');
        sqliteDb = new DatabaseSync(dbPath);
        sqliteDb.exec('PRAGMA journal_mode = WAL;');
        sqliteDb.exec('PRAGMA foreign_keys = ON;');
        console.log(`[DB] Connected to native SQLite engine (node:sqlite) at: ${dbPath}`);
    } catch (e) {
        const sqlite3 = require('sqlite3').verbose();
        const rawDb = new sqlite3.Database(dbPath);
        rawDb.run('PRAGMA journal_mode = WAL;');
        rawDb.run('PRAGMA foreign_keys = ON;');
        sqliteDb = {
            isLegacy: true,
            raw: rawDb,
            exec: (sql) => new Promise((res, rej) => rawDb.exec(sql, err => err ? rej(err) : res())),
            all: (sql, ...params) => new Promise((res, rej) => rawDb.all(sql, params, (err, rows) => err ? rej(err) : res(rows || []))),
            get: (sql, ...params) => new Promise((res, rej) => rawDb.get(sql, params, (err, row) => err ? rej(err) : res(row))),
            run: (sql, ...params) => new Promise((res, rej) => rawDb.run(sql, params, function(err) {
                if (err) return rej(err);
                res({ lastInsertRowid: this.lastID, changes: this.changes });
            }))
        };
        console.log(`[DB] Connected to universal SQLite engine (sqlite3) at: ${dbPath}`);
    }
}

// -------------------------------------------------------------
// Unified Async Database Interface
// -------------------------------------------------------------
const db = {
    isPostgres,

    async query(sql, params = []) {
        if (isPostgres) {
            const pgSql = translateSqlForPostgres(sql);
            const res = await pgPool.query(pgSql, params);
            return res.rows.map(normalizeRow);
        } else if (sqliteDb.isLegacy) {
            const rows = await sqliteDb.all(sql, ...params);
            return rows.map(normalizeRow);
        } else {
            const stmt = sqliteDb.prepare(sql);
            return stmt.all(...params).map(normalizeRow);
        }
    },

    async get(sql, params = []) {
        if (isPostgres) {
            const pgSql = translateSqlForPostgres(sql);
            const res = await pgPool.query(pgSql, params);
            return res.rows.length > 0 ? normalizeRow(res.rows[0]) : null;
        } else if (sqliteDb.isLegacy) {
            const row = await sqliteDb.get(sql, ...params);
            return row ? normalizeRow(row) : null;
        } else {
            const stmt = sqliteDb.prepare(sql);
            const row = stmt.get(...params);
            return row ? normalizeRow(row) : null;
        }
    },

    async all(sql, params = []) {
        return this.query(sql, params);
    },

    async run(sql, params = []) {
        if (isPostgres) {
            let pgSql = translateSqlForPostgres(sql);

            const isInsert = /^\s*INSERT\s+INTO\s+/i.test(pgSql);
            const hasReturning = /RETURNING\s+/i.test(pgSql);
            if (isInsert && !hasReturning) {
                pgSql += ' RETURNING *';
            }

            const res = await pgPool.query(pgSql, params);
            let lastInsertRowid = null;
            if (res.rows && res.rows.length > 0) {
                const firstRow = res.rows[0];
                lastInsertRowid = firstRow.user_id || firstRow.product_id || firstRow.order_id ||
                                  firstRow.address_id || firstRow.cart_item_id || firstRow.wishlist_id ||
                                  firstRow.payment_id || firstRow.log_id || firstRow.id || null;
            }

            return {
                lastInsertRowid,
                changes: res.rowCount,
                rows: res.rows
            };
        } else if (sqliteDb.isLegacy) {
            return sqliteDb.run(sql, ...params);
        } else {
            const stmt = sqliteDb.prepare(sql);
            const res = stmt.run(...params);
            return {
                lastInsertRowid: res.lastInsertRowid,
                changes: res.changes
            };
        }
    },

    async exec(sql) {
        if (isPostgres) {
            return pgPool.query(sql);
        } else if (sqliteDb.isLegacy) {
            return sqliteDb.exec(sql);
        } else {
            return sqliteDb.exec(sql);
        }
    }
};

/**
 * Initialize Database Schema across either PostgreSQL or SQLite
 */
async function initSchema() {
    if (isPostgres) {
        await db.exec(`
            -- 1. USERS & ROLES
            CREATE TABLE IF NOT EXISTS users (
                user_id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                phone TEXT,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'customer',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- 2. CUSTOMER ADDRESSES
            CREATE TABLE IF NOT EXISTS addresses (
                address_id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                full_name TEXT NOT NULL,
                phone TEXT NOT NULL,
                house_name TEXT,
                house_number TEXT,
                street TEXT NOT NULL,
                area TEXT,
                city TEXT NOT NULL,
                district TEXT,
                state TEXT NOT NULL,
                country TEXT NOT NULL DEFAULT 'Saudi Arabia',
                pincode TEXT NOT NULL,
                landmark TEXT,
                address_type TEXT DEFAULT 'Home',
                is_default INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- 3. CATEGORIES
            CREATE TABLE IF NOT EXISTS categories (
                category_id SERIAL PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                slug TEXT NOT NULL UNIQUE,
                icon TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- 4. PRODUCTS
            CREATE TABLE IF NOT EXISTS products (
                product_id SERIAL PRIMARY KEY,
                product_name TEXT NOT NULL,
                SKU TEXT NOT NULL UNIQUE,
                description TEXT,
                category TEXT NOT NULL,
                brand TEXT,
                price NUMERIC(10, 2) NOT NULL,
                discount_price NUMERIC(10, 2),
                discount_percentage INTEGER DEFAULT 0,
                images TEXT,
                thumbnail TEXT,
                stock INTEGER NOT NULL DEFAULT 0,
                variants TEXT,
                colors TEXT,
                specifications TEXT,
                model_3d TEXT DEFAULT 'auto',
                glb_url TEXT DEFAULT NULL,
                enable_3d INTEGER DEFAULT 0,
                generation_status_3d TEXT DEFAULT 'none',
                featured INTEGER DEFAULT 0,
                bestseller INTEGER DEFAULT 0,
                active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- 5. CART ITEMS (PERSISTENT BACKEND CART)
            CREATE TABLE IF NOT EXISTS cart_items (
                cart_item_id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
                quantity INTEGER NOT NULL DEFAULT 1,
                selected_variant TEXT,
                selected_color TEXT,
                price NUMERIC(10, 2) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- 6. WISHLIST (PERSISTENT BACKEND WISHLIST)
            CREATE TABLE IF NOT EXISTS wishlist (
                wishlist_id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, product_id)
            );

            -- 7. ORDERS
            CREATE TABLE IF NOT EXISTS orders (
                order_id SERIAL PRIMARY KEY,
                order_number TEXT NOT NULL UNIQUE,
                user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
                order_date TEXT NOT NULL,
                order_time TEXT NOT NULL,
                subtotal NUMERIC(10, 2) NOT NULL,
                discount NUMERIC(10, 2) DEFAULT 0,
                delivery_charge NUMERIC(10, 2) DEFAULT 0,
                tax NUMERIC(10, 2) DEFAULT 0,
                total_amount NUMERIC(10, 2) NOT NULL,
                payment_method TEXT NOT NULL,
                payment_status TEXT NOT NULL DEFAULT 'Pending',
                order_status TEXT NOT NULL DEFAULT 'Pending',
                shipping_address_json TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- 8. ORDER ITEMS (HISTORICAL SNAPSHOT PER ITEM)
            CREATE TABLE IF NOT EXISTS order_items (
                order_item_id SERIAL PRIMARY KEY,
                order_id INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
                product_id INTEGER NOT NULL,
                product_name TEXT NOT NULL,
                SKU TEXT NOT NULL,
                product_image TEXT,
                quantity INTEGER NOT NULL,
                unit_price NUMERIC(10, 2) NOT NULL,
                discount NUMERIC(10, 2) DEFAULT 0,
                final_price NUMERIC(10, 2) NOT NULL,
                selected_variant TEXT,
                selected_color TEXT
            );

            -- 9. PAYMENTS
            CREATE TABLE IF NOT EXISTS payments (
                payment_id SERIAL PRIMARY KEY,
                order_id INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
                payment_method TEXT NOT NULL,
                payment_status TEXT NOT NULL DEFAULT 'Pending',
                transaction_id TEXT,
                amount NUMERIC(10, 2) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- 10. AUDIT LOGS
            CREATE TABLE IF NOT EXISTS audit_logs (
                log_id SERIAL PRIMARY KEY,
                user_id INTEGER,
                action TEXT NOT NULL,
                entity TEXT NOT NULL,
                entity_id TEXT,
                details TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- 11. APP SETTINGS
            CREATE TABLE IF NOT EXISTS app_settings (
                setting_key TEXT PRIMARY KEY,
                setting_value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- INDEXES
            CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
            CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
            CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
            CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(order_status);
            CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
            CREATE INDEX IF NOT EXISTS idx_cart_user ON cart_items(user_id);
            CREATE INDEX IF NOT EXISTS idx_wishlist_user ON wishlist(user_id);
        `);
    } else {
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                phone TEXT,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'customer',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS addresses (
                address_id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                full_name TEXT NOT NULL,
                phone TEXT NOT NULL,
                house_name TEXT,
                house_number TEXT,
                street TEXT NOT NULL,
                area TEXT,
                city TEXT NOT NULL,
                district TEXT,
                state TEXT NOT NULL,
                country TEXT NOT NULL DEFAULT 'Saudi Arabia',
                pincode TEXT NOT NULL,
                landmark TEXT,
                address_type TEXT DEFAULT 'Home',
                is_default INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS categories (
                category_id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                slug TEXT NOT NULL UNIQUE,
                icon TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS products (
                product_id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_name TEXT NOT NULL,
                SKU TEXT NOT NULL UNIQUE,
                description TEXT,
                category TEXT NOT NULL,
                brand TEXT,
                price REAL NOT NULL,
                discount_price REAL,
                discount_percentage INTEGER DEFAULT 0,
                images TEXT,
                thumbnail TEXT,
                stock INTEGER NOT NULL DEFAULT 0,
                variants TEXT,
                colors TEXT,
                specifications TEXT,
                model_3d TEXT DEFAULT 'auto',
                glb_url TEXT DEFAULT NULL,
                enable_3d INTEGER DEFAULT 0,
                generation_status_3d TEXT DEFAULT 'none',
                featured INTEGER DEFAULT 0,
                bestseller INTEGER DEFAULT 0,
                active INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS cart_items (
                cart_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 1,
                selected_variant TEXT,
                selected_color TEXT,
                price REAL NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
                FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS wishlist (
                wishlist_id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, product_id),
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
                FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS orders (
                order_id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_number TEXT NOT NULL UNIQUE,
                user_id INTEGER NOT NULL,
                order_date TEXT NOT NULL,
                order_time TEXT NOT NULL,
                subtotal REAL NOT NULL,
                discount REAL DEFAULT 0,
                delivery_charge REAL DEFAULT 0,
                tax REAL DEFAULT 0,
                total_amount REAL NOT NULL,
                payment_method TEXT NOT NULL,
                payment_status TEXT NOT NULL DEFAULT 'Pending',
                order_status TEXT NOT NULL DEFAULT 'Pending',
                shipping_address_json TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT
            );

            CREATE TABLE IF NOT EXISTS order_items (
                order_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                product_name TEXT NOT NULL,
                SKU TEXT NOT NULL,
                product_image TEXT,
                quantity INTEGER NOT NULL,
                unit_price REAL NOT NULL,
                discount REAL DEFAULT 0,
                final_price REAL NOT NULL,
                selected_variant TEXT,
                selected_color TEXT,
                FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS payments (
                payment_id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL,
                payment_method TEXT NOT NULL,
                payment_status TEXT NOT NULL DEFAULT 'Pending',
                transaction_id TEXT,
                amount REAL NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS audit_logs (
                log_id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                action TEXT NOT NULL,
                entity TEXT NOT NULL,
                entity_id TEXT,
                details TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                setting_key TEXT PRIMARY KEY,
                setting_value TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
            CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
            CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
            CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(order_status);
            CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
            CREATE INDEX IF NOT EXISTS idx_cart_user ON cart_items(user_id);
            CREATE INDEX IF NOT EXISTS idx_wishlist_user ON wishlist(user_id);
        `);
    }
}

/**
 * Seed initial data if tables are empty
 */
async function seedData() {
    // 1. Super Admin
    const adminCheck = await db.get('SELECT user_id FROM users WHERE email = ?', ['admin@popcarty.com']);
    if (!adminCheck) {
        const adminHash = hashPassword(process.env.DEFAULT_ADMIN_PASSWORD || 'PopCarty@2026!');
        await db.run(`
            INSERT INTO users (name, email, phone, password_hash, role)
            VALUES (?, ?, ?, ?, ?)
        `, ['Pop Carty Admin', process.env.DEFAULT_ADMIN_EMAIL || 'admin@popcarty.com', '+966 50 123 4567', adminHash, 'admin']);
        console.log('✔ Initialized Admin account: admin@popcarty.com / PopCarty@2026!');
    }

    // 2. Demo Customer
    let shopperId;
    const shopperCheck = await db.get('SELECT user_id FROM users WHERE email = ?', ['shopper@popcarty.com']);
    if (!shopperCheck) {
        const shopperHash = hashPassword('Customer@2026!');
        const res = await db.run(`
            INSERT INTO users (name, email, phone, password_hash, role)
            VALUES (?, ?, ?, ?, ?)
        `, ['Sarah Al-Mansoor', 'shopper@popcarty.com', '+966 55 987 6543', shopperHash, 'customer']);
        shopperId = res.lastInsertRowid;
        console.log('✔ Initialized Demo Customer account: shopper@popcarty.com / Customer@2026!');

        if (shopperId) {
            await db.run(`
                INSERT INTO addresses (user_id, full_name, phone, house_name, house_number, street, area, city, district, state, country, pincode, landmark, address_type, is_default)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            `, [
                shopperId,
                'Sarah Al-Mansoor',
                '+966 55 987 6543',
                'Al-Nakheel Villa 14',
                '14B',
                'King Fahd Road',
                'Al Olaya District',
                'Riyadh',
                'Central Region',
                'Riyadh Province',
                'Saudi Arabia',
                '12211',
                'Opposite Kingdom Centre',
                'Home'
            ]);
        }
    } else {
        shopperId = shopperCheck.user_id;
    }

    // 3. Categories
    const categories = [
        { name: 'All Items', slug: 'all', icon: '✨' },
        { name: 'Spatial Audio', slug: 'audio', icon: '🎧' },
        { name: 'Smartwatches', slug: 'watch', icon: '⌚' },
        { name: 'Smart Devices', slug: 'phone', icon: '📱' },
        { name: 'Lifestyle Gear', slug: 'ambient', icon: '⚡' }
    ];

    for (const cat of categories) {
        if (isPostgres) {
            await db.run(`INSERT INTO categories (name, slug, icon) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING`, [cat.name, cat.slug, cat.icon]);
        } else {
            await db.run(`INSERT OR IGNORE INTO categories (name, slug, icon) VALUES (?, ?, ?)`, [cat.name, cat.slug, cat.icon]);
        }
    }

    // 4. Products
    const productCountRow = await db.get('SELECT COUNT(*) as count FROM products');
    const productCount = parseInt(productCountRow ? productCountRow.count : 0, 10);
    if (productCount === 0) {
        const initialProducts = [
            {
                product_name: "Apple AirPods Pro 2",
                SKU: "POP-AIR-PRO2",
                description: "Industry-leading noise cancellation with Adaptive Audio, Transparency mode, and personalized spatial audio with dynamic head tracking. MagSafe USB-C charging case.",
                category: "audio",
                brand: "Apple",
                price: 249.00,
                discount_price: 189.00,
                discount_percentage: 24,
                thumbnail: "/assets/products/airpods_pro.jpg",
                images: JSON.stringify(["/assets/products/airpods_pro.jpg"]),
                stock: 15,
                variants: JSON.stringify(["Standard MagSafe", "USB-C Pro Case"]),
                colors: JSON.stringify([
                    { name: "Pearl White", hex: "#f8fafc" },
                    { name: "Space Gray", hex: "#334155" }
                ]),
                specifications: JSON.stringify({
                    "Noise Cancellation": "Active -48dB Adaptive",
                    "Battery Life": "30 Hours with Case",
                    "Connectivity": "Bluetooth 5.3 + H2 Chip",
                    "Water Resistance": "IP54 Dust & Sweat Resistant",
                    "Warranty": "2 Years Official Warranty"
                }),
                featured: 1,
                bestseller: 1
            },
            {
                product_name: "Samsung Galaxy Watch 6 Ultra",
                SKU: "POP-WAT-ULTRA",
                description: "Titanium squircle chassis with sapphire crystal glass, AMOLED retina display, ECG, blood oxygen, and continuous heart health monitoring.",
                category: "watch",
                brand: "Samsung",
                price: 449.00,
                discount_price: 349.00,
                discount_percentage: 22,
                thumbnail: "/assets/products/galaxy_watch.jpg",
                images: JSON.stringify(["/assets/products/galaxy_watch.jpg"]),
                stock: 12,
                variants: JSON.stringify(["44mm GPS", "47mm LTE"]),
                colors: JSON.stringify([
                    { name: "Silver Titanium", hex: "#e2e8f0" },
                    { name: "Marine Black", hex: "#0f172a" },
                    { name: "Graphite Gold", hex: "#f59e0b" }
                ]),
                specifications: JSON.stringify({
                    "Case Material": "Grade 4 Titanium",
                    "Display": "1.5\" Sapphire AMOLED 2000 nits",
                    "Battery": "Up to 80 hours",
                    "Water Rating": "10 ATM + IP68",
                    "Sensors": "BioActive Optical + BIA"
                }),
                featured: 1,
                bestseller: 1
            },
            {
                product_name: "Sony WH-1000XM5 Headphones",
                SKU: "POP-SONY-XM5",
                description: "Premium over-ear noise-canceling headphones with dual V1 processors, 8 microphones, 30-hour playback, and ultra-plush soft fit leather cushions.",
                category: "audio",
                brand: "Sony",
                price: 399.00,
                discount_price: 279.00,
                discount_percentage: 30,
                thumbnail: "/assets/products/sony_headphones.jpg",
                images: JSON.stringify(["/assets/products/sony_headphones.jpg"]),
                stock: 18,
                variants: JSON.stringify(["Standard Hi-Res"]),
                colors: JSON.stringify([
                    { name: "Midnight Black", hex: "#09090b" },
                    { name: "Silver Sand", hex: "#e2e8f0" }
                ]),
                specifications: JSON.stringify({
                    "ANC Engine": "Dual Processor V1 + QN1",
                    "Driver Unit": "30mm Carbon Fiber",
                    "Battery": "30h Playtime (3m quick charge = 3h)",
                    "Codec": "LDAC, AAC, SBC",
                    "Weight": "250g Ultra Lightweight"
                }),
                featured: 1,
                bestseller: 1
            },
            {
                product_name: "Pop Titan 16 Pro Flagship Phone",
                SKU: "POP-PHN-TITAN16",
                description: "Titanium aerospace frame with borderless 144Hz micro-OLED display, 200MP neural camera array, and 65W wireless hyper-charging.",
                category: "phone",
                brand: "Pop Tech",
                price: 1199.00,
                discount_price: 999.00,
                discount_percentage: 17,
                thumbnail: "/assets/products/iphone_titanium.jpg",
                images: JSON.stringify(["/assets/products/iphone_titanium.jpg"]),
                stock: 8,
                variants: JSON.stringify(["256 GB", "512 GB", "1 TB"]),
                colors: JSON.stringify([
                    { name: "Natural Titanium", hex: "#94a3b8" },
                    { name: "Deep Obsidian", hex: "#0f172a" },
                    { name: "Desert Sand", hex: "#d97706" }
                ]),
                specifications: JSON.stringify({
                    "Processor": "Bionic Gen 5 3nm Chip",
                    "Camera": "200MP Quad Array with 10x Periscope",
                    "Display": "6.8\" ProMotion OLED 144Hz",
                    "Battery": "5200 mAh All-Day Performance",
                    "OS": "PopOS 4.0 Seamless Ecosystem"
                }),
                featured: 1,
                bestseller: 0
            },
            {
                product_name: "JBL Charge 5 Portable Speaker",
                SKU: "POP-JBL-CHG5",
                description: "IP67 waterproof and dustproof portable Bluetooth speaker with separate tweeter, dual passive radiators, and 20 hours of high-output playtime.",
                category: "ambient",
                brand: "JBL",
                price: 179.00,
                discount_price: 129.00,
                discount_percentage: 28,
                thumbnail: "/assets/products/jbl_speaker.jpg",
                images: JSON.stringify(["/assets/products/jbl_speaker.jpg"]),
                stock: 22,
                variants: JSON.stringify(["Standard"]),
                colors: JSON.stringify([
                    { name: "Deep Ocean Blue", hex: "#1e3a8a" },
                    { name: "Fiesta Red", hex: "#dc2626" },
                    { name: "Midnight Black", hex: "#18181b" }
                ]),
                specifications: JSON.stringify({
                    "Output Power": "40W RMS",
                    "Frequency Response": "60Hz - 20kHz",
                    "Waterproofing": "IP67 Waterproof & Dustproof",
                    "Playtime": "20 Hours",
                    "Powerbank": "7500mAh USB-A Device Charger"
                }),
                featured: 0,
                bestseller: 1
            },
            {
                product_name: "Keychron K2 Pro Mechanical Keyboard",
                SKU: "POP-KEY-K2PRO",
                description: "Compact 75% wireless custom mechanical keyboard with hot-swappable tactile switches, double-shot PBT keycaps, and RGB per-key backlighting.",
                category: "ambient",
                brand: "Keychron",
                price: 159.00,
                discount_price: 119.00,
                discount_percentage: 25,
                thumbnail: "/assets/products/keychron_keyboard.jpg",
                images: JSON.stringify(["/assets/products/keychron_keyboard.jpg"]),
                stock: 14,
                variants: JSON.stringify(["75% Compact", "Full 100%"]),
                colors: JSON.stringify([
                    { name: "Graphite Slate", hex: "#334155" },
                    { name: "Artisan White", hex: "#f8fafc" }
                ]),
                specifications: JSON.stringify({
                    "Switches": "Hot-swappable Gateron G Pro",
                    "Connectivity": "Bluetooth 5.1 + Type-C Wired",
                    "Keycaps": "OEM Profile Double-Shot PBT",
                    "Battery": "4000mAh (Up to 300 Hours)",
                    "Compatibility": "Mac, Windows, iOS & Android"
                }),
                featured: 0,
                bestseller: 0
            },
            {
                product_name: "Apple AirPods Max Headset",
                SKU: "POP-AIR-MAX",
                description: "High-fidelity audio with dynamic head tracking, computational audio with dual Apple H1 chips, and breathable acoustic mesh canopy.",
                category: "audio",
                brand: "Apple",
                price: 549.00,
                discount_price: 479.00,
                discount_percentage: 13,
                thumbnail: "/assets/products/airpods_max.jpg",
                images: JSON.stringify(["/assets/products/airpods_max.jpg"]),
                stock: 5,
                variants: JSON.stringify(["USB-C 2026 Edition"]),
                colors: JSON.stringify([
                    { name: "Midnight Black", hex: "#1e1b4b" },
                    { name: "Starlight", hex: "#fef3c7" },
                    { name: "Sky Blue", hex: "#0284c7" }
                ]),
                specifications: JSON.stringify({
                    "Acoustic Architecture": "Custom Apple 40mm Driver",
                    "Chip": "Apple H1 in each ear cup",
                    "Battery": "20 Hours with ANC Active",
                    "Charging": "USB-C Fast Charging",
                    "Smart Case": "Ultra Low Power Storage"
                }),
                featured: 1,
                bestseller: 1
            },
            {
                product_name: "Apple EarPods USB-C Audio",
                SKU: "POP-EAR-USBC",
                description: "Classic ergonomic earbuds with lossless digital audio output, built-in remote for volume and call control, and plug-and-play USB-C connector.",
                category: "audio",
                brand: "Apple",
                price: 29.00,
                discount_price: 19.00,
                discount_percentage: 34,
                thumbnail: "/assets/products/apple_earpods.jpg",
                images: JSON.stringify(["/assets/products/apple_earpods.jpg"]),
                stock: 45,
                variants: JSON.stringify(["USB-C Standard"]),
                colors: JSON.stringify([
                    { name: "Glossy White", hex: "#ffffff" }
                ]),
                specifications: JSON.stringify({
                    "Connector": "USB-C Direct Lossless Audio",
                    "Microphone": "Integrated in-line controller",
                    "Acoustics": "Engineered for deep bass resonance",
                    "Cable Length": "1.2m Durable Tangle-Free"
                }),
                featured: 0,
                bestseller: 0
            }
        ];

        for (const p of initialProducts) {
            await db.run(`
                INSERT INTO products (
                    product_name, SKU, description, category, brand, price, discount_price, 
                    discount_percentage, images, thumbnail, stock, variants, colors, 
                    specifications, featured, bestseller, active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            `, [
                p.product_name, p.SKU, p.description, p.category, p.brand,
                p.price, p.discount_price, p.discount_percentage, p.images,
                p.thumbnail, p.stock, p.variants, p.colors, p.specifications,
                p.featured, p.bestseller
            ]);
        }
        console.log(`✔ Seeded ${initialProducts.length} verified commercial products.`);
    }

    // 5. Initial Demo Order
    const orderCountRow = await db.get('SELECT COUNT(*) as count FROM orders');
    const orderCount = parseInt(orderCountRow ? orderCountRow.count : 0, 10);
    if (orderCount === 0 && shopperId) {
        const orderNumber = 'POP-2026-000001';
        const now = new Date();
        const orderDate = now.toISOString().split('T')[0];
        const orderTime = now.toTimeString().split(' ')[0];

        const addressSnapshot = JSON.stringify({
            full_name: 'Sarah Al-Mansoor',
            phone: '+966 55 987 6543',
            house_name: 'Al-Nakheel Villa 14',
            house_number: '14B',
            street: 'King Fahd Road',
            area: 'Al Olaya District',
            city: 'Riyadh',
            district: 'Central Region',
            state: 'Riyadh Province',
            country: 'Saudi Arabia',
            pincode: '12211',
            landmark: 'Opposite Kingdom Centre'
        });

        const orderRes = await db.run(`
            INSERT INTO orders (
                order_number, user_id, order_date, order_time, subtotal, discount,
                delivery_charge, tax, total_amount, payment_method, payment_status,
                order_status, shipping_address_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            orderNumber, shopperId, orderDate, orderTime, 468.00, 46.80,
            0.00, 63.18, 484.38, 'Online', 'Paid', 'Confirmed', addressSnapshot
        ]);

        const orderId = orderRes.lastInsertRowid;
        if (orderId) {
            await db.run(`
                INSERT INTO order_items (
                    order_id, product_id, product_name, SKU, product_image, quantity,
                    unit_price, discount, final_price, selected_variant, selected_color
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                orderId, 1, 'Apple AirPods Pro 2', 'POP-AIR-PRO2',
                '/assets/products/airpods_pro.jpg', 1, 189.00, 0.00, 189.00,
                'USB-C Pro Case', 'Pearl White'
            ]);

            await db.run(`
                INSERT INTO order_items (
                    order_id, product_id, product_name, SKU, product_image, quantity,
                    unit_price, discount, final_price, selected_variant, selected_color
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                orderId, 3, 'Sony WH-1000XM5 Headphones', 'POP-SONY-XM5',
                '/assets/products/sony_headphones.jpg', 1, 279.00, 0.00, 279.00,
                'Standard Hi-Res', 'Midnight Black'
            ]);

            await db.run(`
                INSERT INTO payments (order_id, payment_method, payment_status, transaction_id, amount)
                VALUES (?, ?, ?, ?, ?)
            `, [orderId, 'Online', 'Paid', 'TXN_SA_2026_9876231', 484.38]);

            await db.run(`
                INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
                VALUES (?, ?, ?, ?, ?)
            `, [shopperId, 'ORDER_PLACED', 'ORDER', orderNumber, 'Customer placed order POP-2026-000001 with total 484.38 SAR']);
        }
        console.log(`✔ Seeded initial verified order: ${orderNumber}`);
    }

    // 6. App Settings
    const settingCheck = await db.get('SELECT setting_key FROM app_settings WHERE setting_key = ?', ['auto_generate_3d']);
    if (!settingCheck) {
        await db.run('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)', ['auto_generate_3d', 'off']);
    }
}

// Auto-initialize on module load
let isReady = false;
const readyPromise = (async () => {
    try {
        await initSchema();
        await seedData();
        isReady = true;
    } catch (err) {
        console.error('[DB] Database initialization error:', err);
    }
})();

module.exports = {
    db,
    hashPassword,
    verifyPassword,
    readyPromise,
    isReady: () => isReady
};
