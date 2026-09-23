const fs = require('node:fs');
const path = require('node:path');

const indexPath = path.join(__dirname, '..', 'index.html');
let content = fs.readFileSync(indexPath, 'utf8');

const regex = /function toggleWishlist\(id, btn\) \{[\s\S]*?document\.getElementById\("wishlistCount"\)\.innerText = wishlist\.length;\s*\}/;

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
                console.warn('Backend wishlist sync note:', err);
            }
        }`;

if (regex.test(content)) {
    content = content.replace(regex, newToggleWishlist);
    fs.writeFileSync(indexPath, content, 'utf8');
    console.log('✔ Successfully patched toggleWishlist');
} else {
    console.error('Regex did not match toggleWishlist block');
}
