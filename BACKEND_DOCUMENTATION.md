# Pop Carty E-Commerce Backend & Database Documentation

## 1. Backend Architecture

The Pop Carty backend is built as a production-grade, zero-dependency REST API and static server running on **Node.js (v24 native runtime)** with an embedded **SQLite (WAL mode)** database engine via `node:sqlite`.

### Key Characteristics
- **Embedded ACID Database**: Built-in SQLite 3 with Write-Ahead Logging (`WAL`), foreign key enforcement, and indexes for sub-millisecond query latency without external database daemon configuration.
- **Stateless Role-Based Auth**: Cryptographically signed HMAC-SHA256 bearer tokens with 7-day expiration. Role-based authorization partitions `customer` and `admin` access levels.
- **Persistent Backend Cart & Wishlist**: Real tables linked by `user_id` and `product_id` ensuring shopping sessions persist across browser refreshes and logins.
- **Immutable Historical Order Snapshots**: Customer delivery addresses and product pricing/specs are snapshotted at time of purchase. Future changes to a customer profile or product catalog do NOT mutate historical orders.
- **Atomic Stock Decrement**: Transactions verify item stock and decrement quantity atomically upon order placement to prevent overselling.

---

## 2. Database Schema & Relationships

The database file is stored at `./data/popcarty.db`.

```
                    ┌──────────────┐
                    │    USERS     │
                    └──────┬───────┘
                           │
       ┌───────────────────┼───────────────────┐
       ▼                   ▼                   ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  ADDRESSES   │   │  CART_ITEMS  │   │   WISHLIST   │
└──────────────┘   └──────┬───────┘   └──────┬───────┘
                          │                  │
                          ▼                  ▼
                   ┌──────────────┐   ┌──────────────┐
                   │   PRODUCTS   │◄──┤  CATEGORIES  │
                   └──────┬───────┘   └──────────────┘
                          │
                          ▼
                   ┌──────────────┐
                   │    ORDERS    │
                   └──────┬───────┘
                          │
       ┌──────────────────┴──────────────────┐
       ▼                                     ▼
┌──────────────┐                      ┌──────────────┐
│ ORDER_ITEMS  │                      │   PAYMENTS   │
└──────────────┘                      └──────────────┘
```

### Relational Tables

1. **`users`**:
   - `user_id` (INTEGER PRIMARY KEY)
   - `name` (TEXT)
   - `email` (TEXT UNIQUE)
   - `phone` (TEXT)
   - `password_hash` (TEXT - PBKDF2 with salt)
   - `role` (TEXT - 'customer' or 'admin')
   - `created_at`, `updated_at` (DATETIME)

2. **`addresses`**:
   - `address_id` (INTEGER PRIMARY KEY)
   - `user_id` (INTEGER, FK -> users)
   - `full_name`, `phone`, `house_name`, `house_number`, `street`, `area`, `city`, `district`, `state`, `country`, `pincode`, `landmark`
   - `address_type` ('Home', 'Work', 'Other')
   - `is_default` (INTEGER 0 or 1)

3. **`categories`**:
   - `category_id` (INTEGER PRIMARY KEY)
   - `name`, `slug`, `icon`

4. **`products`**:
   - `product_id` (INTEGER PRIMARY KEY)
   - `product_name` (TEXT)
   - `SKU` (TEXT UNIQUE)
   - `description` (TEXT)
   - `category` (TEXT)
   - `brand` (TEXT)
   - `price` (REAL)
   - `discount_price` (REAL)
   - `discount_percentage` (INTEGER)
   - `images` (TEXT - JSON array)
   - `thumbnail` (TEXT)
   - `stock` (INTEGER)
   - `variants` (TEXT - JSON array)
   - `colors` (TEXT - JSON array of {name, hex})
   - `specifications` (TEXT - JSON map)
   - `featured`, `bestseller`, `active` (INTEGER)

5. **`cart_items`**:
   - `cart_item_id` (INTEGER PRIMARY KEY)
   - `user_id` (INTEGER, FK -> users)
   - `product_id` (INTEGER, FK -> products)
   - `quantity` (INTEGER)
   - `selected_variant`, `selected_color` (TEXT)
   - `price` (REAL)

6. **`wishlist`**:
   - `wishlist_id` (INTEGER PRIMARY KEY)
   - `user_id` (INTEGER, FK -> users)
   - `product_id` (INTEGER, FK -> products)
   - UNIQUE(`user_id`, `product_id`)

7. **`orders`**:
   - `order_id` (INTEGER PRIMARY KEY)
   - `order_number` (TEXT UNIQUE, e.g. `POP-2026-000001`)
   - `user_id` (INTEGER, FK -> users)
   - `order_date`, `order_time` (TEXT)
   - `subtotal`, `discount`, `delivery_charge`, `tax`, `total_amount` (REAL)
   - `payment_method` ('COD' or 'Online')
   - `payment_status` ('Pending', 'Paid', 'Failed', 'Refunded')
   - `order_status` ('Pending', 'Confirmed', 'Processing', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled', 'Returned', 'Refunded')
   - `shipping_address_json` (TEXT - Immutable JSON snapshot)

8. **`order_items`**:
   - `order_item_id` (INTEGER PRIMARY KEY)
   - `order_id` (INTEGER, FK -> orders)
   - `product_id` (INTEGER)
   - `product_name`, `SKU`, `product_image`
   - `quantity`, `unit_price`, `discount`, `final_price`
   - `selected_variant`, `selected_color`

9. **`payments`**:
   - `payment_id` (INTEGER PRIMARY KEY)
   - `order_id` (INTEGER, FK -> orders)
   - `payment_method`, `payment_status`, `transaction_id`, `amount`

10. **`audit_logs`**:
    - `log_id` (INTEGER PRIMARY KEY)
    - `user_id`, `action`, `entity`, `entity_id`, `details`, `created_at`

---

## 3. REST API Reference

### Authentication
- `POST /api/auth/register`: Create customer account. Body: `{ name, email, phone, password }`.
- `POST /api/auth/login`: Authenticate customer or admin. Body: `{ email, password }`. Returns `{ success: true, token, user }`.
- `GET /api/auth/me`: Get profile of authenticated user. Header: `Authorization: Bearer <token>`.

### Products (Customer)
- `GET /api/products`: Query params: `category`, `search`, `featured`, `bestseller`.
- `GET /api/products/:id`: Get single product by ID.
- `GET /api/categories`: List categories.

### Persistent Cart (Customer)
- `GET /api/cart`: Get current user's cart items with full product details and total amount.
- `POST /api/cart/items`: Add or increment item. Body: `{ product_id, quantity, selected_variant, selected_color }`.
- `PUT /api/cart/items/:id`: Update item quantity. Body: `{ quantity }`.
- `DELETE /api/cart/items/:id`: Remove item from cart.
- `DELETE /api/cart`: Clear cart.

### Persistent Wishlist (Customer)
- `GET /api/wishlist`: Get list of favorited products.
- `POST /api/wishlist`: Toggle favorite status. Body: `{ product_id }`.
- `DELETE /api/wishlist/:productId`: Remove from favorites.

### Customer Addresses
- `GET /api/addresses`: Get saved addresses for checkout.
- `POST /api/addresses`: Add new address.
- `PUT /api/addresses/:id`: Edit address.
- `DELETE /api/addresses/:id`: Delete address.

### Orders & Tracking (Customer)
- `POST /api/orders`: Place verified order. Body: `{ items, shipping_address, payment_method, discount_code }`. Decrements stock, snapshots address, creates order and payment records, and clears user cart.
- `GET /api/orders`: Get customer's order history with tracking statuses.
- `GET /api/orders/:id`: Inspect full order summary with address snapshot and items.

### Admin Control Center (`Authorization: Bearer <admin_token>` Required)
- `GET /api/admin/dashboard`: Real metrics (`totalProducts`, `totalCustomers`, `totalOrders`, `pendingOrders`, `completedOrders`, `cancelledOrders`, `totalSales`, `lowStockProducts`) + recent orders.
- `GET /api/admin/products`: List all products (active and inactive) with search.
- `POST /api/admin/products`: Add new product into database.
- `PUT /api/admin/products/:id`: Edit product fields (price, image, stock, active status, description).
- `DELETE /api/admin/products/:id`: Deactivate product.
- `GET /api/admin/orders`: Search orders by number, customer name, email, phone; filter by status.
- `GET /api/admin/orders/:id`: Full inspection of order, customer profile, items, financial breakdown, and immutable delivery snapshot.
- `PUT /api/admin/orders/:id/status`: Update order status (`Pending`, `Confirmed`, `Processing`, `Packed`, `Shipped`, `Out for Delivery`, `Delivered`, `Cancelled`, `Refunded`).
- `GET /api/admin/users`: Customer directory with order count and total spent.
- `GET /api/admin/inventory`: Stock level monitor with low stock warnings.
- `GET /api/admin/audit-logs`: History of administrative modifications.

---

## 4. Default Seed Accounts

The database is pre-seeded with verified test accounts:

| Role | Email | Password | Access Level |
| :--- | :--- | :--- | :--- |
| **Super Admin** | `admin@popcarty.com` | `PopCarty@2026!` | Full Admin Control Center (`/admin`) |
| **Demo Customer** | `shopper@popcarty.com` | `Customer@2026!` | Customer Store, Cart, Orders, Addresses |

---

## 5. How to Run Locally

1. **Quick Launch (Windows)**:
   Double-click `start-server.bat` in the project root, or execute:
   ```powershell
   .\start-server.bat
   ```

2. **Command Line Execution**:
   ```powershell
   & "$env:APPDATA\Antigravity\bin\agy-node.cmd" server.js
   ```
   Or if system Node.js is installed:
   ```bash
   node server.js
   ```

3. **Access URLs**:
   - Customer Store: `http://localhost:3000/`
   - Admin Dashboard: `http://localhost:3000/admin`
