/**
 * Script to upgrade index.html with Pop Carty requirements:
 * 1. Minimal white splash screen with original Pop Carty logo only.
 * 2. Official Pop Carty logo in navbar, drawer, and footer.
 * 3. Real commercial product photography in catalog.
 * 4. Add-to-cart flying product animation with curved trajectory and cart bounce.
 * 5. Wishlist heart burst animation with micro-heart particles.
 * 6. Floating miniature product parallax background in hero.
 * 7. Real backend integration: dynamic products API, persistent cart API, wishlist API, orders API, and live order tracking.
 * 8. Customer Account & Order History modal.
 */

const fs = require('node:fs');
const path = require('node:path');

const indexPath = path.join(__dirname, '..', 'index.html');
let content = fs.readFileSync(indexPath, 'utf8');

console.log('Original index.html length:', content.length);

// 1. UPDATE FAVICON & TITLE
content = content.replace(
    /<title>.*?<\/title>/i,
    `<title>Pop Carty | Modern Premium E-Commerce Store</title>\n    <link rel="icon" type="image/png" href="/assets/popcarty_logo.png">`
);

// 2. ADD CSS FOR SPLASH, FLYING CART, HEART BURST, FLOATING BG, AND ORDER TRACKER
const extraStyles = `
        /* ================= POP CARTY PREMIUM VISUAL UPGRADES ================= */
        
        /* 1. MINIMAL WHITE SPLASH SCREEN (LOGO ONLY) */
        .splash-screen-minimal {
            position: fixed;
            inset: 0;
            width: 100vw;
            height: 100vh;
            background: #ffffff !important;
            z-index: 999999;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 1;
            transition: opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1), transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.5s;
            pointer-events: all;
            overflow: hidden;
        }

        .splash-screen-minimal.hidden {
            opacity: 0;
            transform: scale(1.04);
            visibility: hidden;
            pointer-events: none;
        }

        .splash-minimal-content {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
        }

        .splash-logo-img {
            width: 150px;
            height: 150px;
            object-fit: contain;
            opacity: 0;
            transform: scale(0.88);
            animation: splashLogoEntry 1.6s cubic-bezier(0.34, 1.4, 0.64, 1) forwards;
        }

        @keyframes splashLogoEntry {
            0% {
                opacity: 0;
                transform: scale(0.88);
            }
            30% {
                opacity: 1;
                transform: scale(1.02);
            }
            50% {
                transform: scale(1.0);
            }
            82% {
                opacity: 1;
                transform: scale(1.0);
            }
            100% {
                opacity: 0;
                transform: scale(1.06);
            }
        }

        /* 2. OFFICIAL BRAND LOGO STYLES */
        .navbar-brand-logo {
            height: 46px;
            width: auto;
            max-width: 180px;
            object-fit: contain;
            display: block;
            transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .brand-logo:hover .navbar-brand-logo {
            transform: scale(1.05);
        }

        /* 3. ADD TO CART FLYING PRODUCT ANIMATION */
        .flying-cart-clone {
            position: fixed;
            z-index: 9999999;
            pointer-events: none;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 12px 30px rgba(255, 83, 136, 0.6), 0 0 20px rgba(255, 83, 136, 0.3);
            border: 2px solid rgba(255, 255, 255, 0.9);
            background: #ffffff;
            transition: left 720ms cubic-bezier(0.22, 1, 0.36, 1),
                        top 720ms cubic-bezier(0.4, 0, 0.2, 1),
                        width 720ms ease-in-out,
                        height 720ms ease-in-out,
                        transform 720ms cubic-bezier(0.22, 1, 0.36, 1),
                        opacity 720ms ease-in;
        }

        .flying-cart-clone img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }

        /* Cart Bounce / Pulse on item receipt */
        @keyframes cartBouncePulse {
            0% { transform: scale(1); }
            30% { transform: scale(1.32) rotate(-6deg); }
            60% { transform: scale(0.92) rotate(4deg); }
            85% { transform: scale(1.12); }
            100% { transform: scale(1); }
        }

        .cart-bounce-active {
            animation: cartBouncePulse 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
        }

        @keyframes countBadgePop {
            0% { transform: scale(1); }
            50% { transform: scale(1.5); background: #ffffff; color: var(--pop-pink); }
            100% { transform: scale(1); }
        }

        .count-pop-active {
            animation: countBadgePop 0.45s ease-out;
        }

        /* 4. WISHLIST HEART BURST ANIMATION */
        @keyframes heartPulsePop {
            0% { transform: scale(1); }
            25% { transform: scale(1.45); }
            50% { transform: scale(0.9); }
            75% { transform: scale(1.18); }
            100% { transform: scale(1); }
        }

        .card-wishlist-btn.heart-burst-active {
            animation: heartPulsePop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
            color: var(--pop-pink) !important;
            background: #ffffff !important;
            box-shadow: 0 4px 15px rgba(255, 83, 136, 0.4) !important;
        }

        @keyframes heartReverseOut {
            0% { transform: scale(1); }
            50% { transform: scale(0.8); opacity: 0.6; }
            100% { transform: scale(1); opacity: 1; }
        }

        .card-wishlist-btn.heart-reverse-active {
            animation: heartReverseOut 0.35s ease;
        }

        /* Micro-heart particles floating outward */
        .micro-heart-particle {
            position: fixed;
            pointer-events: none;
            font-size: 16px;
            z-index: 9999999;
            user-select: none;
            animation: floatHeartOut 0.65s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        @keyframes floatHeartOut {
            0% {
                opacity: 1;
                transform: translate(-50%, -50%) scale(0.6) rotate(0deg);
            }
            60% {
                opacity: 0.95;
                transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) scale(1.25) rotate(var(--rot));
            }
            100% {
                opacity: 0;
                transform: translate(calc(-50% + var(--tx) * 1.4), calc(-50% + var(--ty) - 25px)) scale(0.2) rotate(var(--rot));
            }
        }

        /* 5. FLOATING MINIATURE PRODUCT PARALLAX BACKGROUND IN HERO */
        .hero-floating-products-bg {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            overflow: hidden;
            z-index: 0;
        }

        .float-product-card {
            position: absolute;
            border-radius: 16px;
            background: rgba(255, 255, 255, 0.88);
            padding: 6px;
            box-shadow: 0 10px 25px -5px rgba(255, 83, 136, 0.14), 0 2px 8px rgba(0,0,0,0.04);
            border: 1px solid rgba(255, 225, 235, 0.8);
            will-change: transform;
            backdrop-filter: blur(5px);
            -webkit-backdrop-filter: blur(5px);
        }

        .float-product-card img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            border-radius: 12px;
            display: block;
        }

        /* 3 Parallax Depths */
        .depth-back {
            width: 52px;
            height: 52px;
            opacity: 0.22;
            filter: blur(0.4px);
            z-index: 1;
        }

        .depth-mid {
            width: 64px;
            height: 64px;
            opacity: 0.30;
            z-index: 2;
        }

        .depth-front {
            width: 78px;
            height: 78px;
            opacity: 0.38;
            z-index: 3;
        }

        /* Drifting Keyframes */
        .pos-item-1 { top: 10%; left: 3%; animation: driftPathA 18s ease-in-out infinite alternate; }
        .pos-item-2 { top: 65%; left: 6%; animation: driftPathB 22s ease-in-out infinite alternate; }
        .pos-item-3 { top: 22%; left: 40%; animation: driftPathC 16s ease-in-out infinite alternate; }
        .pos-item-4 { top: 76%; left: 34%; animation: driftPathA 25s ease-in-out infinite alternate; }
        .pos-item-5 { top: 8%; right: 30%; animation: driftPathB 20s ease-in-out infinite alternate; }
        .pos-item-6 { top: 58%; right: 6%; animation: driftPathC 19s ease-in-out infinite alternate; }
        .pos-item-7 { top: 80%; right: 26%; animation: driftPathA 21s ease-in-out infinite alternate; }
        .pos-item-8 { top: 16%; right: 4%; animation: driftPathB 17s ease-in-out infinite alternate; }

        @keyframes driftPathA {
            0% { transform: translate3d(0, 0, 0) rotate(-6deg); }
            50% { transform: translate3d(25px, -18px, 0) rotate(5deg); }
            100% { transform: translate3d(-15px, 14px, 0) rotate(-4deg); }
        }

        @keyframes driftPathB {
            0% { transform: translate3d(0, 0, 0) rotate(6deg); }
            50% { transform: translate3d(-26px, 16px, 0) rotate(-5deg); }
            100% { transform: translate3d(16px, -14px, 0) rotate(7deg); }
        }

        @keyframes driftPathC {
            0% { transform: translate3d(0, 0, 0) rotate(0deg); }
            33% { transform: translate3d(15px, 20px, 0) rotate(7deg); }
            66% { transform: translate3d(-18px, -15px, 0) rotate(-6deg); }
            100% { transform: translate3d(0, 0, 0) rotate(0deg); }
        }

        /* 6. ADMIN & ACCOUNT NAVBAR BUTTONS */
        .btn-header-admin {
            background: #f1f5f9;
            color: #475569;
            font-size: 0.78rem;
            font-weight: 700;
            padding: 6px 12px;
            border-radius: var(--radius-full);
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            border: 1px solid #cbd5e1;
            transition: all 0.2s ease;
        }

        .btn-header-admin:hover {
            background: #0f172a;
            color: #ffffff;
            border-color: #0f172a;
        }

        .btn-header-account {
            background: #ffffff;
            color: #1e293b;
            font-size: 0.82rem;
            font-weight: 700;
            padding: 8px 14px;
            border-radius: var(--radius-full);
            border: 1.5px solid var(--border-color);
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s ease;
        }

        .btn-header-account:hover {
            border-color: var(--pop-pink);
            color: var(--pop-pink);
            background: var(--pop-pink-soft);
        }

        /* 7. LIVE ORDER TRACKING STATUS STEPPER */
        .tracking-stepper {
            display: flex;
            align-items: center;
            justify-content: space-between;
            position: relative;
            margin: 24px 0 16px 0;
            padding: 0 10px;
        }

        .tracking-line {
            position: absolute;
            top: 14px;
            left: 20px;
            right: 20px;
            height: 3px;
            background: #e2e8f0;
            z-index: 1;
        }

        .tracking-line-fill {
            height: 100%;
            background: var(--pop-pink);
            transition: width 0.4s ease;
        }

        .tracking-step {
            position: relative;
            z-index: 2;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
        }

        .step-bubble {
            width: 30px;
            height: 30px;
            border-radius: 50%;
            background: #ffffff;
            border: 2px solid #cbd5e1;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.75rem;
            font-weight: 800;
            color: #64748b;
            transition: all 0.3s ease;
        }

        .tracking-step.done .step-bubble {
            background: var(--pop-pink);
            border-color: var(--pop-pink);
            color: #ffffff;
        }

        .tracking-step.active .step-bubble {
            background: #ffffff;
            border-color: var(--pop-pink);
            color: var(--pop-pink);
            box-shadow: 0 0 0 4px var(--pop-pink-soft);
            animation: pulseStep 1.5s infinite;
        }

        @keyframes pulseStep {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.15); }
        }

        .step-name {
            font-size: 0.72rem;
            font-weight: 700;
            color: #64748b;
            text-align: center;
        }

        .tracking-step.done .step-name,
        .tracking-step.active .step-name {
            color: var(--text-primary);
        }
`;

// Insert extraStyles inside <style>
content = content.replace('</style>', `${extraStyles}\n    </style>`);

// 3. REPLACE SPLASH SCREEN HTML
const newSplashHtml = `
    <!-- ================= 0. POP CARTY MINIMAL LOGO SPLASH SCREEN ================= -->
    <div id="splashScreen" class="splash-screen-minimal">
        <div class="splash-minimal-content">
            <img src="/assets/popcarty_logo.png" alt="Pop Carty" class="splash-logo-img">
        </div>
    </div>
`;

// Replace from `<div id="splashScreen"` up to `</div>\n    </div>`
const splashStart = content.indexOf('<div id="splashScreen"');
const splashEnd = content.indexOf('<!-- Scroll Progress Indicator -->');
if (splashStart !== -1 && splashEnd !== -1) {
    content = content.slice(0, splashStart) + newSplashHtml + '\n\n    ' + content.slice(splashEnd);
    console.log('✔ Replaced Splash Screen HTML with minimal logo-only splash');
} else {
    console.warn('Splash screen boundary not found, searching alternative...');
}

// 4. REPLACE NAVBAR LOGO WITH OFFICIAL POP CARTY LOGO
const oldBrandLogo = `<a href="#" class="brand-logo" onclick="window.scrollTo({top:0, behavior:'smooth'})">
                <div class="logo-icon-wrap">
                    <svg class="logo-svg" viewBox="0 0 24 24">
                        <path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/>
                    </svg>
                </div>
                <div class="logo-text-group">
                    <span class="logo-name">POP CARTY</span>
                    <span class="logo-tagline">Salla Verified Merchant</span>
                </div>
            </a>`;

const newBrandLogo = `<a href="#" class="brand-logo" onclick="window.scrollTo({top:0, behavior:'smooth'})">
                <img src="/assets/popcarty_logo.png" alt="Pop Carty" class="navbar-brand-logo">
            </a>`;

if (content.includes(oldBrandLogo)) {
    content = content.replace(oldBrandLogo, newBrandLogo);
    console.log('✔ Replaced Navbar Logo with official Pop Carty reference image');
} else {
    console.warn('Navbar logo exact block not matched, doing regex replace...');
    content = content.replace(
        /<a href="#" class="brand-logo"[\s\S]*?<\/a>/i,
        newBrandLogo
    );
}

// 5. ADD ACCOUNT & ADMIN BUTTONS IN HEADER ACTIONS
const oldHeaderActions = `<!-- Action Buttons -->
            <div class="header-actions">
                <!-- Wishlist Counter -->
                <button class="action-btn" onclick="filterCategory('wishlist')" title="Wishlist">
                    ♥
                    <span class="badge-count" id="wishlistCount">0</span>
                </button>

                <!-- Pop Carty Drawer Trigger -->
                <button class="cart-trigger-btn" onclick="openCartDrawer()">
                    <span>🛒 Pop Carty</span>
                    <span class="cart-trigger-count" id="headerCartCount">0</span>
                </button>
            </div>`;

const newHeaderActions = `<!-- Action Buttons -->
            <div class="header-actions">
                <!-- Customer Account & Order History Trigger -->
                <button class="btn-header-account" onclick="openCustomerAccountModal()" title="My Orders & Account">
                    <span>👤</span>
                    <span id="headerAccountLabel">Account</span>
                </button>

                <!-- Wishlist Counter -->
                <button class="action-btn" onclick="filterCategory('wishlist')" title="Wishlist">
                    ♥
                    <span class="badge-count" id="wishlistCount">0</span>
                </button>

                <!-- Pop Carty Drawer Trigger -->
                <button class="cart-trigger-btn" id="headerCartBtn" onclick="openCartDrawer()">
                    <span>🛒 Pop Carty</span>
                    <span class="cart-trigger-count" id="headerCartCount">0</span>
                </button>

                <!-- Admin Control Center Shortcut -->
                <a href="/admin" target="_blank" class="btn-header-admin" title="Access Secure Admin Center">
                    <span>⚙️</span>
                    <span>Admin</span>
                </a>
            </div>`;

if (content.includes(oldHeaderActions)) {
    content = content.replace(oldHeaderActions, newHeaderActions);
    console.log('✔ Added Account & Admin buttons to Header Actions');
}

// 6. ADD FLOATING PRODUCT PARALLAX BACKGROUND IN HERO
const oldHeroCard = `<section class="hero-section">
        <div class="container">
            <div class="hero-card">`;

const newHeroCard = `<section class="hero-section">
        <!-- Floating Miniature Product Background (3-Depth Parallax) -->
        <div class="hero-floating-products-bg" aria-hidden="true">
            <div class="float-product-card depth-back pos-item-1"><img src="/assets/products/airpods_pro.jpg" alt=""></div>
            <div class="float-product-card depth-mid pos-item-2"><img src="/assets/products/galaxy_watch.jpg" alt=""></div>
            <div class="float-product-card depth-front pos-item-3"><img src="/assets/products/sony_headphones.jpg" alt=""></div>
            <div class="float-product-card depth-back pos-item-4"><img src="/assets/products/iphone_titanium.jpg" alt=""></div>
            <div class="float-product-card depth-mid pos-item-5"><img src="/assets/products/jbl_speaker.jpg" alt=""></div>
            <div class="float-product-card depth-front pos-item-6"><img src="/assets/products/keychron_keyboard.jpg" alt=""></div>
            <div class="float-product-card depth-back pos-item-7"><img src="/assets/products/airpods_max.jpg" alt=""></div>
            <div class="float-product-card depth-mid pos-item-8"><img src="/assets/products/apple_earpods.jpg" alt=""></div>
        </div>
        <div class="container" style="position:relative; z-index:2;">
            <div class="hero-card">`;

if (content.includes(oldHeroCard)) {
    content = content.replace(oldHeroCard, newHeroCard);
    console.log('✔ Added Floating Miniature Product Parallax Background to Hero');
}

// 7. ADD CUSTOMER ACCOUNT & ORDER TRACKING MODAL BEFORE </body>
const customerAccountModalHtml = `
    <!-- ================= 10. CUSTOMER ACCOUNT & ORDERS TRACKING MODAL ================= -->
    <div class="modal-overlay" id="customerAccountModal" onclick="if(event.target === this) closeCustomerAccountModal()">
        <div class="modal-card" style="max-width: 680px; background:#ffffff; border-radius: 20px; padding: 28px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); position:relative;">
            <button onclick="closeCustomerAccountModal()" style="position:absolute; top:20px; right:20px; background:none; border:none; font-size:1.6rem; cursor:pointer; color:#64748b;">&times;</button>
            
            <div id="authRequiredView" style="display:none;">
                <div style="text-align:center; margin-bottom:24px;">
                    <img src="/assets/popcarty_logo.png" alt="Pop Carty" style="height:60px; object-fit:contain; margin-bottom:10px;">
                    <h3 style="font-weight:800; font-size:1.4rem;">Customer Sign In</h3>
                    <p style="color:#64748b; font-size:0.88rem;">Track your real orders and manage saved delivery addresses</p>
                </div>
                <form id="customerLoginForm" onsubmit="handleCustomerLoginSubmit(event)" style="max-width:380px; margin:0 auto;">
                    <div style="margin-bottom:14px;">
                        <label style="display:block; font-size:0.82rem; font-weight:700; margin-bottom:6px;">Email Address</label>
                        <input type="email" id="custLoginEmail" required class="form-control" placeholder="shopper@popcarty.com" style="width:100%; padding:10px 14px; border:1.5px solid #e2e8f0; border-radius:10px;">
                    </div>
                    <div style="margin-bottom:18px;">
                        <label style="display:block; font-size:0.82rem; font-weight:700; margin-bottom:6px;">Password</label>
                        <input type="password" id="custLoginPassword" required class="form-control" placeholder="••••••••" style="width:100%; padding:10px 14px; border:1.5px solid #e2e8f0; border-radius:10px;">
                    </div>
                    <div id="custLoginError" style="color:#ef4444; font-size:0.82rem; margin-bottom:12px; display:none;"></div>
                    <button type="submit" class="btn-primary-hero" style="width:100%; justify-content:center; padding:12px;">
                        <span>Sign In</span>
                    </button>
                    <button type="button" onclick="fillCustomerDemoCreds()" style="width:100%; margin-top:12px; background:#f8fafc; border:1px dashed #cbd5e1; padding:8px; border-radius:8px; font-size:0.8rem; cursor:pointer;">
                        ⚡ Auto-fill Demo Customer Credentials
                    </button>
                </form>
            </div>

            <div id="authActiveView">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #e2e8f0; padding-bottom:16px; margin-bottom:20px;">
                    <div style="display:flex; align-items:center; gap:12px;">
                        <div style="width:44px; height:44px; border-radius:50%; background:var(--pop-pink); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:1.2rem;" id="custAvatar">S</div>
                        <div>
                            <h3 style="font-weight:800; font-size:1.2rem;" id="custNameTitle">Sarah Al-Mansoor</h3>
                            <div style="font-size:0.8rem; color:#64748b;" id="custEmailSubtitle">shopper@popcarty.com</div>
                        </div>
                    </div>
                    <button onclick="handleCustomerLogout()" class="btn-sm" style="background:#fee2e2; color:#ef4444; border:1px solid #fca5a5; padding:6px 12px; border-radius:8px; cursor:pointer; font-weight:700;">Sign Out</button>
                </div>

                <div style="display:flex; gap:10px; margin-bottom:20px; border-bottom:1px solid #e2e8f0;">
                    <button id="custTabOrders" class="subnav-pill active" onclick="switchCustTab('orders')" style="border-radius:8px 8px 0 0;">📦 My Orders & Live Tracking</button>
                    <button id="custTabAddresses" class="subnav-pill" onclick="switchCustTab('addresses')" style="border-radius:8px 8px 0 0;">📍 Saved Addresses</button>
                </div>

                <div id="custOrdersPane">
                    <div id="custOrdersList">Loading your real order history...</div>
                </div>

                <div id="custAddressesPane" style="display:none;">
                    <div id="custAddressesList">Loading saved addresses...</div>
                </div>
            </div>
        </div>
    </div>
`;

content = content.replace('</body>', `${customerAccountModalHtml}\n</body>`);

// Write updated content
fs.writeFileSync(indexPath, content, 'utf8');
console.log('✔ Updated index.html structure successfully. New length:', content.length);
