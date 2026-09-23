const fs = require('node:fs');
const path = require('node:path');

const indexPath = path.join(__dirname, '..', 'index.html');
let content = fs.readFileSync(indexPath, 'utf8');

// Update footer logo
const oldFooterBrand = `<div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
                        <div class="logo-icon-wrap" style="width:34px; height:34px;">
                            <svg class="logo-svg" viewBox="0 0 24 24" style="width:20px; height:20px;">
                                <path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/>
                            </svg>
                        </div>
                        <span style="font-family:var(--font-display); font-size:1.2rem; font-weight:800; color:#ffffff;">POP CARTY</span>
                    </div>`;

const newFooterBrand = `<div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
                        <img src="/assets/popcarty_logo.png" alt="Pop Carty" style="height:44px; width:auto; object-fit:contain; background:#ffffff; border-radius:10px; padding:4px;">
                    </div>`;

if (content.includes(oldFooterBrand)) {
    content = content.replace(oldFooterBrand, newFooterBrand);
    console.log('✔ Replaced Footer logo with official Pop Carty reference image');
} else {
    console.warn('Footer brand block not matched verbatim, using regex...');
    content = content.replace(
        /<div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">[\s\S]*?<span style="font-family:var\(--font-display\); font-size:1\.2rem; font-weight:800; color:#ffffff;">POP CARTY<\/span>[\s\S]*?<\/div>/,
        newFooterBrand
    );
    console.log('✔ Replaced Footer logo with regex');
}

// Update Drawer header logo
content = content.replace(
    '<div class="drawer-title-group">\n                    <span style="font-size:1.3rem;">🛒</span>\n                    <h3 class="drawer-title">Your Pop Carty</h3>',
    '<div class="drawer-title-group">\n                    <img src="/assets/popcarty_logo.png" alt="Pop Carty" style="height:32px; width:auto; object-fit:contain;">\n                    <h3 class="drawer-title">Your Pop Carty</h3>'
);

fs.writeFileSync(indexPath, content, 'utf8');
console.log('✔ Footer and Drawer branding updated');
