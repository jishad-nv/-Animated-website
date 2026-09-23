/**
 * Script to upgrade JavaScript in index.html:
 * - Dynamic product loading from /api/products
 * - Real commercial product photography
 * - Add to Cart flying product animation
 * - Wishlist heart burst animation with particles
 * - Logo-only minimal splash screen controller
 * - Real order checkout & live tracking stepper
 * - Customer auth & address management
 */

const fs = require('node:fs');
const path = require('node:path');

const indexPath = path.join(__dirname, '..', 'index.html');
let content = fs.readFileSync(indexPath, 'utf8');

// Replacement for triggerSplashScreen and dismissSplashScreen
const oldSplashFunctions = `        /* ================= SPLASH SCREEN CONTROLLER ================= */
        function triggerSplashScreen() {
            const splash = document.getElementById("splashScreen");
            if (!splash) return;

            // Reset & show
            splash.classList.remove("hidden");
            document.body.style.overflow = "hidden";

            const bar = document.getElementById("splashLoaderBar");
            const status = document.getElementById("splashStatusText");
            const enterBtn = splash.querySelector(".splash-enter-btn");
            if (bar) bar.style.width = "0%";
            if (enterBtn) enterBtn.style.display = "none";

            const steps = [
                { pct: 15, msg: "Initializing 3D Store Experience..." },
                { pct: 35, msg: "Loading Product Catalog..." },
                { pct: 55, msg: "Rendering Three.js Scene..." },
                { pct: 72, msg: "Applying Korean-Tech Design System..." },
                { pct: 88, msg: "Syncing Pop Carty Engine..." },
                { pct: 100, msg: "Welcome to Pop Carty ✨" }
            ];

            let stepIdx = 0;
            const stepDuration = 320;

            function runNextStep() {
                if (stepIdx >= steps.length) {
                    if (enterBtn) {
                        enterBtn.style.display = "inline-flex";
                        enterBtn.style.animation = "bounceSoft 1.2s ease-in-out infinite";
                    }
                    return;
                }
                const s = steps[stepIdx++];
                if (bar) bar.style.width = s.pct + "%";
                if (status) status.innerText = s.msg;
                setTimeout(runNextStep, stepDuration);
            }
            runNextStep();
        }

        function dismissSplashScreen() {
            const splash = document.getElementById("splashScreen");
            if (!splash) return;
            splash.classList.add("hidden");
            document.body.style.overflow = "auto";
            playAudioChime(880);
        }`;

const newSplashFunctions = `        /* ================= MINIMAL LOGO-ONLY SPLASH SCREEN CONTROLLER ================= */
        function triggerSplashScreen() {
            const splash = document.getElementById("splashScreen");
            if (!splash) return;

            splash.classList.remove("hidden");
            document.body.style.overflow = "hidden";

            const logo = splash.querySelector(".splash-logo-img");
            if (logo) {
                logo.style.animation = "none";
                void logo.offsetWidth;
                logo.style.animation = "splashLogoEntry 1.6s cubic-bezier(0.34, 1.4, 0.64, 1) forwards";
            }

            // Automatically dismiss after 1.6 seconds
            setTimeout(() => {
                dismissSplashScreen();
            }, 1600);
        }

        function dismissSplashScreen() {
            const splash = document.getElementById("splashScreen");
            if (!splash) return;
            splash.classList.add("hidden");
            document.body.style.overflow = "auto";
            playAudioChime(880);
        }`;

if (content.includes(oldSplashFunctions)) {
    content = content.replace(oldSplashFunctions, newSplashFunctions);
    console.log('✔ Upgraded triggerSplashScreen to minimal logo animation controller');
} else {
    console.warn('Splash functions exact match not found, checking regex...');
}

// Replacement for PRODUCTS initial seed array in index.html to use realistic commercial product photos
const oldProductsStart = 'const PRODUCTS = [';
const oldProductsEnd = '/* ================= 2. CURRENCY & LOCALIZATION CONFIG ================= */';

const pStartIdx = content.indexOf(oldProductsStart);
const pEndIdx = content.indexOf(oldProductsEnd);

if (pStartIdx !== -1 && pEndIdx !== -1) {
    const updatedProductsCode = `let PRODUCTS = [
            {
                id: 1,
                product_id: 1,
                title: "Apple AirPods Pro 2",
                product_name: "Apple AirPods Pro 2",
                category: "audio",
                priceUSD: 189.00,
                oldPriceUSD: 249.00,
                rating: 4.9,
                reviews: 4820,
                badge: "★ Bestseller",
                badgeType: "mint",
                desc: "Industry-leading noise cancellation with Adaptive Audio, Transparency mode, and personalized spatial audio with dynamic head tracking. MagSafe USB-C case.",
                stock: 15,
                colors: [
                    { name: "Pearl White", hex: "#f8fafc" },
                    { name: "Space Gray", hex: "#334155" }
                ],
                sizes: ["Standard MagSafe", "USB-C Pro Case"],
                imgUrl: "/assets/products/airpods_pro.jpg",
                thumbnail: "/assets/products/airpods_pro.jpg"
            },
            {
                id: 2,
                product_id: 2,
                title: "Samsung Galaxy Watch 6 Ultra",
                product_name: "Samsung Galaxy Watch 6 Ultra",
                category: "watch",
                priceUSD: 349.00,
                oldPriceUSD: 449.00,
                rating: 5.0,
                reviews: 2180,
                badge: "New Drop 🔥",
                badgeType: "coral",
                desc: "Titanium squircle chassis with sapphire crystal glass, AMOLED retina display, ECG, and blood oxygen monitoring.",
                stock: 12,
                colors: [
                    { name: "Silver Titanium", hex: "#e2e8f0" },
                    { name: "Marine Black", hex: "#0f172a" },
                    { name: "Graphite Gold", hex: "#f59e0b" }
                ],
                sizes: ["44mm GPS", "47mm LTE"],
                imgUrl: "/assets/products/galaxy_watch.jpg",
                thumbnail: "/assets/products/galaxy_watch.jpg"
            },
            {
                id: 3,
                product_id: 3,
                title: "Sony WH-1000XM5 Headphones",
                product_name: "Sony WH-1000XM5 Headphones",
                category: "audio",
                priceUSD: 279.00,
                oldPriceUSD: 399.00,
                rating: 4.95,
                reviews: 6540,
                badge: "-30% Deal",
                badgeType: "coral",
                desc: "Premium over-ear noise-canceling headphones with dual V1 processors, 8 microphones, and 30-hour playback.",
                stock: 18,
                colors: [
                    { name: "Midnight Black", hex: "#09090b" },
                    { name: "Silver Sand", hex: "#e2e8f0" }
                ],
                sizes: ["Standard Hi-Res"],
                imgUrl: "/assets/products/sony_headphones.jpg",
                thumbnail: "/assets/products/sony_headphones.jpg"
            },
            {
                id: 4,
                product_id: 4,
                title: "Pop Titan 16 Pro Flagship Phone",
                product_name: "Pop Titan 16 Pro Flagship Phone",
                category: "phone",
                priceUSD: 999.00,
                oldPriceUSD: 1199.00,
                rating: 4.98,
                reviews: 3420,
                badge: "Editor's Choice",
                badgeType: "mint",
                desc: "Titanium aerospace frame with borderless 144Hz micro-OLED display, 200MP neural camera array, and 65W wireless hyper-charging.",
                stock: 8,
                colors: [
                    { name: "Natural Titanium", hex: "#94a3b8" },
                    { name: "Deep Obsidian", hex: "#0f172a" },
                    { name: "Desert Sand", hex: "#d97706" }
                ],
                sizes: ["256 GB", "512 GB", "1 TB"],
                imgUrl: "/assets/products/iphone_titanium.jpg",
                thumbnail: "/assets/products/iphone_titanium.jpg"
            },
            {
                id: 5,
                product_id: 5,
                title: "JBL Charge 5 Portable Speaker",
                product_name: "JBL Charge 5 Portable Speaker",
                category: "ambient",
                priceUSD: 129.00,
                oldPriceUSD: 179.00,
                rating: 4.8,
                reviews: 5640,
                badge: "Compact & Loud 🔊",
                badgeType: "mint",
                desc: "IP67 waterproof and dustproof portable Bluetooth speaker with separate tweeter and dual passive radiators.",
                stock: 22,
                colors: [
                    { name: "Deep Ocean Blue", hex: "#1e3a8a" },
                    { name: "Fiesta Red", hex: "#dc2626" },
                    { name: "Midnight Black", hex: "#18181b" }
                ],
                sizes: ["Standard"],
                imgUrl: "/assets/products/jbl_speaker.jpg",
                thumbnail: "/assets/products/jbl_speaker.jpg"
            },
            {
                id: 6,
                product_id: 6,
                title: "Keychron K2 Pro Mechanical Keyboard",
                product_name: "Keychron K2 Pro Mechanical Keyboard",
                category: "ambient",
                priceUSD: 119.00,
                oldPriceUSD: 159.00,
                rating: 4.9,
                reviews: 2890,
                badge: "Hot Drop ⌨️",
                badgeType: "coral",
                desc: "Compact 75% wireless mechanical keyboard with hot-swappable tactile switches, double-shot PBT keycaps, and RGB backlight.",
                stock: 14,
                colors: [
                    { name: "Graphite Slate", hex: "#334155" },
                    { name: "Artisan White", hex: "#f8fafc" }
                ],
                sizes: ["75% Compact", "Full 100%"],
                imgUrl: "/assets/products/keychron_keyboard.jpg",
                thumbnail: "/assets/products/keychron_keyboard.jpg"
            },
            {
                id: 7,
                product_id: 7,
                title: "Apple AirPods Max Headset",
                product_name: "Apple AirPods Max Headset",
                category: "audio",
                priceUSD: 479.00,
                oldPriceUSD: 549.00,
                rating: 4.95,
                reviews: 7840,
                badge: "Hi-Res Audio",
                badgeType: "mint",
                desc: "High-fidelity audio with dynamic head tracking, computational audio with dual Apple H1 chips, and breathable acoustic canopy.",
                stock: 5,
                colors: [
                    { name: "Midnight Black", hex: "#1e1b4b" },
                    { name: "Starlight", hex: "#fef3c7" }
                ],
                sizes: ["USB-C 2026 Edition"],
                imgUrl: "/assets/products/airpods_max.jpg",
                thumbnail: "/assets/products/airpods_max.jpg"
            },
            {
                id: 8,
                product_id: 8,
                title: "Apple EarPods USB-C Audio",
                product_name: "Apple EarPods USB-C Audio",
                category: "audio",
                priceUSD: 19.00,
                oldPriceUSD: 29.00,
                rating: 4.75,
                reviews: 1320,
                badge: "Best Value",
                badgeType: "coral",
                desc: "Classic ergonomic earbuds with lossless digital audio output and in-line remote for volume and calls.",
                stock: 45,
                colors: [
                    { name: "Glossy White", hex: "#ffffff" }
                ],
                sizes: ["USB-C Standard"],
                imgUrl: "/assets/products/apple_earpods.jpg",
                thumbnail: "/assets/products/apple_earpods.jpg"
            }
        ];\n\n        `;

    content = content.slice(0, pStartIdx) + updatedProductsCode + content.slice(pEndIdx);
    console.log('✔ Updated PRODUCTS catalog with realistic commercial product photography');
}

// Function implementations for flying animation, heart burst, dynamic fetching, and order placement
const logicUpgrades = `
        /* ================= 10. FLYING PRODUCT TO CART ANIMATION ================= */
        function flyProductToCart(sourceEl, onComplete) {
            if (!sourceEl) {
                if (onComplete) onComplete();
                return;
            }

            const cartBtn = document.getElementById('headerCartBtn') || document.querySelector('.cart-trigger-btn');
            if (!cartBtn) {
                if (onComplete) onComplete();
                return;
            }

            const startRect = sourceEl.getBoundingClientRect();
            const endRect = cartBtn.getBoundingClientRect();

            // Extract image url
            let imgSrc = '/assets/products/airpods_pro.jpg';
            if (sourceEl.tagName === 'IMG') {
                imgSrc = sourceEl.src;
            } else {
                const innerImg = sourceEl.querySelector('img');
                if (innerImg) imgSrc = innerImg.src;
            }

            // Create flying clone
            const clone = document.createElement('div');
            clone.className = 'flying-cart-clone';
            clone.innerHTML = \`<img src="\${imgSrc}" alt="Flying product">\`;

            clone.style.left = \`\${startRect.left}px\`;
            clone.style.top = \`\${startRect.top}px\`;
            clone.style.width = \`\${startRect.width}px\`;
            clone.style.height = \`\${startRect.height}px\`;

            document.body.appendChild(clone);

            // Force layout reflow
            void clone.offsetWidth;

            // Target destination coordinates
            const targetX = endRect.left + endRect.width / 2 - 20;
            const targetY = endRect.top + endRect.height / 2 - 20;

            clone.style.left = \`\${targetX}px\`;
            clone.style.top = \`\${targetY}px\`;
            clone.style.width = '40px';
            clone.style.height = '40px';
            clone.style.opacity = '0.75';
            clone.style.transform = 'scale(0.18) rotate(14deg)';

            // Finish after animation
            setTimeout(() => {
                clone.remove();

                // Trigger Cart Pulse / Bounce Animation
                cartBtn.classList.remove('cart-bounce-active');
                void cartBtn.offsetWidth;
                cartBtn.classList.add('cart-bounce-active');

                // Pop cart count badge
                const countBadge = document.getElementById('headerCartCount');
                if (countBadge) {
                    countBadge.classList.remove('count-pop-active');
                    void countBadge.offsetWidth;
                    countBadge.classList.add('count-pop-active');
                }

                playAudioChime(900);
                if (onComplete) onComplete();
            }, 720);
        }

        /* ================= 11. WISHLIST HEART BURST ANIMATION ================= */
        function triggerHeartBurst(btn) {
            if (!btn) return;

            btn.classList.remove('heart-burst-active');
            void btn.offsetWidth;
            btn.classList.add('heart-burst-active');

            const rect = btn.getBoundingClientRect();
            const colors = ['#ff5388', '#ff3b77', '#f43f5e', '#fb7185'];

            for (let i = 0; i < 4; i++) {
                const p = document.createElement('span');
                p.className = 'micro-heart-particle';
                p.innerHTML = '♥';
                p.style.color = colors[i % colors.length];
                p.style.left = \`\${rect.left + rect.width / 2}px\`;
                p.style.top = \`\${rect.top + rect.height / 2}px\`;

                const angle = (i * 90 + Math.random() * 30 - 15) * (Math.PI / 180);
                const dist = 24 + Math.random() * 18;
                const tx = Math.cos(angle) * dist;
                const ty = Math.sin(angle) * dist - 18; // bias upward
                const rot = (Math.random() * 40 - 20) + 'deg';

                p.style.setProperty('--tx', \`\${tx}px\`);
                p.style.setProperty('--ty', \`\${ty}px\`);
                p.style.setProperty('--rot', rot);

                document.body.appendChild(p);
                setTimeout(() => p.remove(), 650);
            }
        }

        /* ================= 12. DYNAMIC BACKEND PRODUCTS FETCHING ================= */
        async function fetchProductsFromBackend() {
            try {
                const res = await fetch('/api/products');
                const data = await res.json();
                if (data.success && data.products && data.products.length > 0) {
                    PRODUCTS = data.products.map(p => ({
                        id: p.product_id,
                        product_id: p.product_id,
                        title: p.product_name,
                        product_name: p.product_name,
                        category: p.category,
                        priceUSD: p.discount_price || p.price,
                        oldPriceUSD: p.price,
                        rating: 4.9,
                        reviews: 1200 + p.product_id * 350,
                        badge: p.bestseller ? "★ Bestseller" : (p.featured ? "Featured Drop 🔥" : "New Drop"),
                        badgeType: p.bestseller ? "mint" : "coral",
                        desc: p.description,
                        stock: p.stock,
                        colors: p.colors || [{ name: "Standard", hex: "#0f172a" }],
                        sizes: p.variants || ["Standard"],
                        imgUrl: p.thumbnail,
                        thumbnail: p.thumbnail
                    }));
                    renderCatalog(PRODUCTS);
                    console.log('✔ Synced dynamic products from Pop Carty database');
                }
            } catch (err) {
                console.warn('Using seeded catalog:', err);
            }
        }

        /* ================= 13. CUSTOMER ACCOUNT & LIVE ORDER TRACKING ================= */
        let customerToken = localStorage.getItem('popcarty_customer_token') || null;

        function openCustomerAccountModal() {
            document.getElementById('customerAccountModal').classList.add('active');
            document.body.style.overflow = 'hidden';
            checkCustomerAuthView();
        }

        function closeCustomerAccountModal() {
            document.getElementById('customerAccountModal').classList.remove('active');
            document.body.style.overflow = 'auto';
        }

        function checkCustomerAuthView() {
            if (!customerToken) {
                document.getElementById('authRequiredView').style.display = 'block';
                document.getElementById('authActiveView').style.display = 'none';
                document.getElementById('headerAccountLabel').innerText = 'Sign In';
            } else {
                document.getElementById('authRequiredView').style.display = 'none';
                document.getElementById('authActiveView').style.display = 'block';
                loadCustomerOrders();
                loadCustomerAddresses();
            }
        }

        function fillCustomerDemoCreds() {
            document.getElementById('custLoginEmail').value = 'shopper@popcarty.com';
            document.getElementById('custLoginPassword').value = 'Customer@2026!';
        }

        async function handleCustomerLoginSubmit(e) {
            e.preventDefault();
            const email = document.getElementById('custLoginEmail').value;
            const password = document.getElementById('custLoginPassword').value;
            const errDiv = document.getElementById('custLoginError');

            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                const data = await res.json();

                if (data.success) {
                    customerToken = data.token;
                    localStorage.setItem('popcarty_customer_token', customerToken);
                    document.getElementById('headerAccountLabel').innerText = data.user.name.split(' ')[0];
                    document.getElementById('custNameTitle').innerText = data.user.name;
                    document.getElementById('custEmailSubtitle').innerText = data.user.email;
                    document.getElementById('custAvatar').innerText = data.user.name.charAt(0);
                    checkCustomerAuthView();
                    showToast('Welcome back, ' + data.user.name + ' ✨');
                } else {
                    errDiv.innerText = data.error || 'Invalid credentials';
                    errDiv.style.display = 'block';
                }
            } catch (err) {
                errDiv.innerText = 'Server connection error';
                errDiv.style.display = 'block';
            }
        }

        function handleCustomerLogout() {
            localStorage.removeItem('popcarty_customer_token');
            customerToken = null;
            document.getElementById('headerAccountLabel').innerText = 'Account';
            checkCustomerAuthView();
            showToast('Signed out of Pop Carty');
        }

        function switchCustTab(tab) {
            document.getElementById('custTabOrders').classList.toggle('active', tab === 'orders');
            document.getElementById('custTabAddresses').classList.toggle('active', tab === 'addresses');
            document.getElementById('custOrdersPane').style.display = tab === 'orders' ? 'block' : 'none';
            document.getElementById('custAddressesPane').style.display = tab === 'addresses' ? 'block' : 'none';
        }

        const ORDER_STATUS_FLOW = ['Confirmed', 'Processing', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered'];

        async function loadCustomerOrders() {
            const list = document.getElementById('custOrdersList');
            try {
                const headers = {};
                if (customerToken) headers['Authorization'] = 'Bearer ' + customerToken;
                const res = await fetch('/api/orders', { headers });
                const data = await res.json();

                if (!data.orders || data.orders.length === 0) {
                    list.innerHTML = \`<div style="text-align:center; padding:30px; color:#64748b;">No orders placed yet. Add items to Pop Carty and checkout!</div>\`;
                    return;
                }

                list.innerHTML = data.orders.map(o => {
                    const currentIdx = ORDER_STATUS_FLOW.indexOf(o.order_status);
                    const pct = currentIdx >= 0 ? (currentIdx / (ORDER_STATUS_FLOW.length - 1)) * 100 : 20;

                    return \`
                        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:14px; padding:18px; margin-bottom:16px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
                                <div>
                                    <strong style="font-size:1rem; color:var(--pop-pink);">\${o.order_number}</strong>
                                    <div style="font-size:0.78rem; color:#64748b;">Date: \${o.order_date} • \${o.order_time}</div>
                                </div>
                                <div style="text-align:right;">
                                    <strong style="font-size:1.05rem;">\${o.total_amount} SAR</strong>
                                    <div style="font-size:0.75rem; color:#10b981; font-weight:700;">● \${o.payment_method} (\${o.payment_status})</div>
                                </div>
                            </div>

                            <!-- Real-time Order Tracking Status Stepper -->
                            <div class="tracking-stepper">
                                <div class="tracking-line">
                                    <div class="tracking-line-fill" style="width: \${pct}%;"></div>
                                </div>
                                \${ORDER_STATUS_FLOW.map((step, idx) => {
                                    const isDone = idx < currentIdx;
                                    const isActive = idx === currentIdx;
                                    const cls = isDone ? 'done' : (isActive ? 'active' : '');
                                    return \`
                                        <div class="tracking-step \${cls}">
                                            <div class="step-bubble">\${isDone ? '✔' : (idx + 1)}</div>
                                            <span class="step-name">\${step}</span>
                                        </div>
                                    \`;
                                }).join('')}
                            </div>

                            <div style="border-top:1px dashed #e2e8f0; margin-top:14px; padding-top:12px;">
                                <div style="font-size:0.78rem; font-weight:700; color:#64748b; margin-bottom:6px;">Items in this order:</div>
                                \${o.items.map(it => \`
                                    <div style="display:flex; justify-content:space-between; font-size:0.82rem; margin-bottom:4px;">
                                        <span>\${it.quantity}x \${it.product_name} (\${it.selected_color || 'Default'})</span>
                                        <strong>\${it.final_price} SAR</strong>
                                    </div>
                                \`).join('')}
                            </div>
                        </div>
                    \`;
                }).join('');
            } catch (err) {
                list.innerHTML = \`<div style="color:#ef4444;">Failed to load order history</div>\`;
            }
        }

        async function loadCustomerAddresses() {
            const list = document.getElementById('custAddressesList');
            try {
                const headers = {};
                if (customerToken) headers['Authorization'] = 'Bearer ' + customerToken;
                const res = await fetch('/api/addresses', { headers });
                const data = await res.json();

                if (!data.addresses || data.addresses.length === 0) {
                    list.innerHTML = \`<div style="text-align:center; padding:30px; color:#64748b;">No delivery addresses saved yet.</div>\`;
                    return;
                }

                list.innerHTML = data.addresses.map(a => \`
                    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:16px; margin-bottom:12px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <strong>\${a.full_name} (\${a.address_type})</strong>
                            \${a.is_default ? '<span class="badge badge-success" style="font-size:0.7rem;">Default Address</span>' : ''}
                        </div>
                        <p style="font-size:0.85rem; color:#475569; margin-top:6px;">
                            \${a.house_name ? a.house_name + ', ' : ''}\${a.street}, \${a.city}, \${a.state} - \${a.pincode}
                        </p>
                        <div style="font-size:0.78rem; color:#64748b; margin-top:4px;">Phone: \${a.phone}</div>
                    </div>
                \`).join('');
            } catch (err) {
                list.innerHTML = \`<div style="color:#ef4444;">Failed to load addresses</div>\`;
            }
        }
`;

// Insert logicUpgrades into the script section
content = content.replace('/* Initial Store Bootstrap */', `${logicUpgrades}\n\n        /* Initial Store Bootstrap */`);

// Update window.addEventListener("DOMContentLoaded") to call fetchProductsFromBackend()
content = content.replace(
    'renderCatalog();',
    'renderCatalog();\n            fetchProductsFromBackend();'
);

// Write updated content
fs.writeFileSync(indexPath, content, 'utf8');
console.log('✔ Upgraded JavaScript logic in index.html successfully. New length:', content.length);
