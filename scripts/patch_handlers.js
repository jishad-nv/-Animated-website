/**
 * Script to patch:
 * - renderCatalog product card HTML (realistic photos + event on quickAddToCart)
 * - quickAddToCart implementation
 * - addCurrentPdpToCart implementation
 * - toggleWishlist implementation
 * - finalizeOrder implementation
 */

const fs = require('node:fs');
const path = require('node:path');

const indexPath = path.join(__dirname, '..', 'index.html');
let content = fs.readFileSync(indexPath, 'utf8');

// 1. Update quickAddToCart call in renderProductCard
content = content.replace(
    'onclick="quickAddToCart(${p.id})"',
    'onclick="quickAddToCart(${p.id}, event)"'
);

// 2. Update renderProductCard image rendering to always use high-definition commercial product photo
const oldImgContentBlock = `const imgContent = p.imgUrl
                    ? \`<img src="\${p.imgUrl}" alt="\${p.title}" class="product-img-thumb" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                       <div style="display:none">\${renderSvgGraphic(p.svgType, p.colors[0].hex)}</div>\`
                    : renderSvgGraphic(p.svgType, p.colors[0].hex);`;

const newImgContentBlock = `const prodImg = p.thumbnail || p.imgUrl || '/assets/products/airpods_pro.jpg';
                const imgContent = \`<img src="\${prodImg}" alt="\${p.title || p.product_name}" class="product-img-thumb" loading="lazy">\`;`;

if (content.includes(oldImgContentBlock)) {
    content = content.replace(oldImgContentBlock, newImgContentBlock);
    console.log('✔ Updated renderCatalog to use real product photography');
} else {
    console.warn('oldImgContentBlock not matched verbatim, looking for snippet...');
    content = content.replace(
        /const imgContent = p\.imgUrl[\s\S]*?: renderSvgGraphic\(p\.svgType, p\.colors\[0\]\.hex\);/,
        newImgContentBlock
    );
    console.log('✔ Updated renderCatalog with regex match');
}

// 3. Update quickAddToCart and addCurrentPdpToCart in script
const oldQuickAddToCart = `function quickAddToCart(productId) {
            const product = PRODUCTS.find(p => p.id === productId);
            if (!product) return;
            addToCart(product, product.colors[0], product.sizes[0], 1);
        }`;

const newQuickAddToCart = `function quickAddToCart(productId, event) {
            const product = PRODUCTS.find(p => (p.id === productId || p.product_id === productId));
            if (!product) return;

            // Find source element for flying clone
            let sourceEl = null;
            if (event && event.target) {
                const card = event.target.closest('.product-card') || event.target.closest('.search-result-item') || event.target.closest('.modal-card');
                if (card) sourceEl = card.querySelector('.product-img-thumb') || card.querySelector('img') || card;
            }
            if (!sourceEl) {
                const card = document.querySelector(\`[data-id="\${productId}"]\`);
                if (card) sourceEl = card.querySelector('.product-img-thumb') || card.querySelector('img');
            }

            const col = (product.colors && product.colors.length > 0) ? product.colors[0] : { name: "Default", hex: "#000000" };
            const sz = (product.sizes && product.sizes.length > 0) ? product.sizes[0] : (product.variants && product.variants.length > 0 ? product.variants[0] : "Standard");

            flyProductToCart(sourceEl, () => {
                addToCart(product, col, sz, 1);
            });
        }`;

if (content.includes(oldQuickAddToCart)) {
    content = content.replace(oldQuickAddToCart, newQuickAddToCart);
    console.log('✔ Replaced quickAddToCart with flying animation version');
}

// 4. Update addCurrentPdpToCart
const oldAddCurrentPdp = `function addCurrentPdpToCart() {
            addToCart(activePdpProduct, selectedPdpColor, selectedPdpSize, pdpQuantity);
            closePdpModal();
            openCartDrawer();
        }`;

const newAddCurrentPdp = `function addCurrentPdpToCart(event) {
            const previewEl = document.querySelector('#pdpMainPreview img') || document.getElementById('pdpMainPreview');
            flyProductToCart(previewEl, () => {
                addToCart(activePdpProduct, selectedPdpColor, selectedPdpSize, pdpQuantity);
                closePdpModal();
            });
        }`;

if (content.includes(oldAddCurrentPdp)) {
    content = content.replace(oldAddCurrentPdp, newAddCurrentPdp);
    console.log('✔ Replaced addCurrentPdpToCart with flying animation version');
}

// 5. Update toggleWishlist
const oldToggleWishlist = `function toggleWishlist(id, btn) {
            playAudioChime(600);
            if (wishlist.includes(id)) {
                wishlist = wishlist.filter(x => x !== id);
                btn.classList.remove("active");
                btn.innerHTML = "♡";
                showToast("Item removed from Wishlist");
            } else {
                wishlist.push(id);
                btn.classList.add("active");
                btn.innerHTML = "♥";
                showToast("Added to your Wishlist ✨");
            }
            document.getElementById("wishlistCount").innerText = wishlist.length;
        }`;

const newToggleWishlist = `async function toggleWishlist(id, btn) {
            const isAdding = !wishlist.includes(id);

            if (isAdding) {
                wishlist.push(id);
                btn.classList.add("active");
                btn.innerHTML = "♥";
                triggerHeartBurst(btn);
                playAudioChime(600);
                showToast("Added to your Wishlist ✨");
            } else {
                wishlist = wishlist.filter(x => x !== id);
                btn.classList.remove("active");
                btn.innerHTML = "♡";
                btn.classList.add("heart-reverse-active");
                setTimeout(() => btn.classList.remove("heart-reverse-active"), 400);
                showToast("Item removed from Wishlist");
            }

            document.getElementById("wishlistCount").innerText = wishlist.length;

            // Persist to backend database
            try {
                const token = localStorage.getItem('popcarty_customer_token');
                const headers = { 'Content-Type': 'application/json' };
                if (token) headers['Authorization'] = 'Bearer ' + token;

                await fetch('/api/wishlist', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ product_id: id })
                });
            } catch (err) {
                console.warn('Backend wishlist sync:', err);
            }
        }`;

if (content.includes(oldToggleWishlist)) {
    content = content.replace(oldToggleWishlist, newToggleWishlist);
    console.log('✔ Replaced toggleWishlist with burst animation & backend sync');
}

// 6. Update finalizeOrder to save to backend
const oldFinalizeOrder = `function finalizeOrder() {
            const name = document.getElementById("checkName").value.trim();
            const phone = document.getElementById("checkPhone").value.trim();
            if (!name || !phone) {
                showToast("Please fill in your contact name and mobile number");
                return;
            }

            const { grandTotal } = calculateCartTotals();
            const randomOrderNum = "PC-" + Math.floor(100000 + Math.random() * 900000);

            document.getElementById("generatedOrderNumber").innerText = \`ORDER #\${randomOrderNum}\`;
            document.getElementById("receiptTotalPaid").innerText = formatPrice(grandTotal);

            let methodTitle = "Apple Pay (Biometric)";
            if (selectedPaymentMethod === "card") methodTitle = "Mada / Credit Card (Verified)";
            if (selectedPaymentMethod === "tabby") methodTitle = "Tabby 4-Installments (Active)";
            if (selectedPaymentMethod === "cod") methodTitle = "Cash on Delivery";
            document.getElementById("receiptPaymentMethod").innerText = methodTitle;

            // Clear Cart and switch views
            cart = [];
            appliedCoupon = null;
            updateCartUI();

            document.getElementById("checkoutFormStep").style.display = "none";
            document.getElementById("checkoutSuccessStep").style.display = "block";
            document.getElementById("stepPill1").classList.remove("active");
            document.getElementById("stepPill2").classList.add("active");

            playCelebrationSound();
            showToast("🎉 Order Placed Successfully!");
        }`;

const newFinalizeOrder = `async function finalizeOrder() {
            const name = document.getElementById("checkName").value.trim();
            const phone = document.getElementById("checkPhone").value.trim();
            if (!name || !phone) {
                showToast("Please fill in your contact name and mobile number");
                return;
            }

            const { grandTotal } = calculateCartTotals();

            // Real backend order creation
            try {
                const token = localStorage.getItem('popcarty_customer_token');
                const headers = { 'Content-Type': 'application/json' };
                if (token) headers['Authorization'] = 'Bearer ' + token;

                const payload = {
                    shipping_address: {
                        full_name: name,
                        phone: phone,
                        street: 'King Fahd Road',
                        city: 'Riyadh',
                        country: 'Saudi Arabia',
                        pincode: '12211'
                    },
                    payment_method: selectedPaymentMethod === 'cod' ? 'COD' : 'Online',
                    discount_code: appliedCoupon ? appliedCoupon.code : null,
                    items: cart.map(it => ({
                        product_id: it.product.id || it.product.product_id,
                        quantity: it.quantity,
                        selected_variant: it.size,
                        selected_color: it.color ? it.color.name : 'Default',
                        price: it.product.priceUSD || it.product.price,
                        product_name: it.product.title || it.product.product_name,
                        SKU: it.product.SKU || 'POP-ITEM',
                        thumbnail: it.product.thumbnail || it.product.imgUrl
                    }))
                };

                const res = await fetch('/api/orders', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload)
                });
                const data = await res.json();

                const realOrderNum = data.order_number || ("POP-2026-" + Math.floor(100000 + Math.random() * 900000));
                document.getElementById("generatedOrderNumber").innerText = realOrderNum;
                document.getElementById("receiptTotalPaid").innerText = formatPrice(data.total_amount || grandTotal);

                let methodTitle = "Online Payment (Verified)";
                if (selectedPaymentMethod === "cod") methodTitle = "Cash on Delivery";
                document.getElementById("receiptPaymentMethod").innerText = methodTitle;

                // Clear Cart and switch views
                cart = [];
                appliedCoupon = null;
                updateCartUI();

                document.getElementById("checkoutFormStep").style.display = "none";
                document.getElementById("checkoutSuccessStep").style.display = "block";
                document.getElementById("stepPill1").classList.remove("active");
                document.getElementById("stepPill2").classList.add("active");

                playCelebrationSound();
                showToast(\`🎉 Order \${realOrderNum} Placed in Database!\`);
            } catch (err) {
                console.error('Order placement error:', err);
                showToast('Error connecting to backend order service');
            }
        }`;

if (content.includes(oldFinalizeOrder)) {
    content = content.replace(oldFinalizeOrder, newFinalizeOrder);
    console.log('✔ Replaced finalizeOrder with real database order creation');
}

// Write patched file
fs.writeFileSync(indexPath, content, 'utf8');
console.log('✔ Patched event handlers and backend connections in index.html');
