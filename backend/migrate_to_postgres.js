/**
 * Pop Carty - SQLite to PostgreSQL Automated Migration Tool
 * 
 * Usage:
 *   DATABASE_URL="postgresql://user:password@host/db?sslmode=require" node backend/migrate_to_postgres.js
 * Or:
 *   npm run migrate
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { Pool } = require('pg');

// Zero-dependency .env loader
const envPaths = [
    path.join(__dirname, '.env'),
    path.join(__dirname, '..', '.env')
];
for (const p of envPaths) {
    if (fs.existsSync(p)) {
        try {
            const content = fs.readFileSync(p, 'utf8');
            for (const line of content.split(/\r?\n/)) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx !== -1) {
                    const key = trimmed.slice(0, eqIdx).trim();
                    const val = trimmed.slice(eqIdx + 1).trim();
                    if (!process.env[key]) process.env[key] = val;
                }
            }
        } catch (e) {}
    }
}

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!DATABASE_URL) {
    console.error('❌ Error: DATABASE_URL or POSTGRES_URL environment variable is required.');
    console.error('Example: DATABASE_URL="postgresql://user:pass@ep-cool-db.us-east-2.aws.neon.tech/popcarty?sslmode=require"');
    process.exit(1);
}

const sqliteDbPath = path.join(__dirname, '..', 'data', 'popcarty.db');
if (!fs.existsSync(sqliteDbPath)) {
    console.error(`❌ Error: Source SQLite database not found at ${sqliteDbPath}`);
    process.exit(1);
}

const sslConfig = (process.env.PGSSLMODE === 'disable' || DATABASE_URL.includes('sslmode=disable'))
    ? false
    : { rejectUnauthorized: false };

const pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: sslConfig
});

const sqlite = new DatabaseSync(sqliteDbPath);

async function migrate() {
    console.log('========================================================');
    console.log('🚀 Pop Carty - SQLite to PostgreSQL Database Migration');
    console.log(`   Source: ${sqliteDbPath}`);
    console.log(`   Target: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);
    console.log('========================================================\n');

    const client = await pgPool.connect();

    try {
        await client.query('BEGIN');

        console.log('1. Creating PostgreSQL schema and tables...');
        await client.query(`
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

            CREATE TABLE IF NOT EXISTS categories (
                category_id SERIAL PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                slug TEXT NOT NULL UNIQUE,
                icon TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

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

            CREATE TABLE IF NOT EXISTS wishlist (
                wishlist_id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, product_id)
            );

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

            CREATE TABLE IF NOT EXISTS audit_logs (
                log_id SERIAL PRIMARY KEY,
                user_id INTEGER,
                action TEXT NOT NULL,
                entity TEXT NOT NULL,
                entity_id TEXT,
                details TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                setting_key TEXT PRIMARY KEY,
                setting_value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✔ Schema verified.');

        // Function to migrate a table
        async function migrateTable(tableName, pkeyCol) {
            const rows = sqlite.prepare(`SELECT * FROM ${tableName}`).all();
            if (rows.length === 0) {
                console.log(`ℹ ${tableName}: 0 rows to migrate.`);
                return;
            }

            const cols = Object.keys(rows[0]);
            const colNames = cols.map(c => `"${c}"`).join(', ');

            for (const row of rows) {
                const vals = cols.map(c => row[c]);
                const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
                const updateSets = cols.filter(c => c !== pkeyCol).map(c => `"${c}" = EXCLUDED."${c}"`).join(', ');

                const conflictClause = pkeyCol
                    ? `ON CONFLICT ("${pkeyCol}") DO UPDATE SET ${updateSets}`
                    : 'ON CONFLICT DO NOTHING';

                const query = `INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders}) ${conflictClause}`;
                await client.query(query, vals);
            }

            // Sync sequence if primary key exists
            if (pkeyCol) {
                try {
                    await client.query(`
                        SELECT setval(pg_get_serial_sequence('${tableName}', '${pkeyCol}'), COALESCE(MAX("${pkeyCol}"), 1))
                        FROM "${tableName}";
                    `);
                } catch (e) {}
            }

            console.log(`✔ ${tableName}: Migrated ${rows.length} rows.`);
        }

        console.log('\n2. Migrating rows...');
        await migrateTable('users', 'user_id');
        await migrateTable('addresses', 'address_id');
        await migrateTable('categories', 'category_id');
        await migrateTable('products', 'product_id');
        await migrateTable('cart_items', 'cart_item_id');
        await migrateTable('wishlist', 'wishlist_id');
        await migrateTable('orders', 'order_id');
        await migrateTable('order_items', 'order_item_id');
        await migrateTable('payments', 'payment_id');
        await migrateTable('audit_logs', 'log_id');
        await migrateTable('app_settings', 'setting_key');

        await client.query('COMMIT');
        console.log('\n🎉 Migration completed successfully! PostgreSQL is ready for production.\n');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Migration failed:', err);
        process.exit(1);
    } finally {
        client.release();
        await pgPool.end();
    }
}

migrate();
