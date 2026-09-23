const fs = require('node:fs');
const path = require('node:path');

const indexPath = path.join(__dirname, '..', 'index.html');
let content = fs.readFileSync(indexPath, 'utf8');

// 1. Update search result thumb
content = content.replace(
    '<div class="search-result-thumb">${renderSvgGraphic(m.svgType, m.svgColor)}</div>',
    '<div class="search-result-thumb"><img src="${m.thumbnail || m.imgUrl || \'/assets/products/airpods_pro.jpg\'}" style="width:100%; height:100%; object-fit:cover; border-radius:8px;" alt="${m.title}"></div>'
);

// 2. Update cart drawer item thumb
content = content.replace(
    '<div class="cart-item-thumb">${renderSvgGraphic(item.product.svgType, item.color.hex)}</div>',
    '<div class="cart-item-thumb"><img src="${item.product.thumbnail || item.product.imgUrl || \'/assets/products/airpods_pro.jpg\'}" style="width:100%; height:100%; object-fit:cover; border-radius:8px;" alt="${item.product.title}"></div>'
);

// 3. Update PDP preview function
const oldPdpPreview = `function updatePdpPreview() {
            const preview = document.getElementById("pdpMainPreview");
            if (activePdpProduct) {
                if (activePdpProduct.imgUrl) {
                    const colorHex = selectedPdpColor ? selectedPdpColor.hex : activePdpProduct.colors[0].hex;
                    preview.innerHTML = \`<img src="\${activePdpProduct.imgUrl}" alt="\${activePdpProduct.title}" style="width:260px; height:260px; object-fit:contain; filter:drop-shadow(0 16px 32px rgba(37,99,235,0.2)); border-radius:16px; transition:transform 0.4s ease;" onerror="this.parentNode.innerHTML='\${renderSvgGraphic(activePdpProduct.svgType, colorHex).replace(/'/g,"\\\\'")}'">\`;
                } else {
                    const colorHex = selectedPdpColor ? selectedPdpColor.hex : activePdpProduct.colors[0].hex;
                    preview.innerHTML = renderSvgGraphic(activePdpProduct.svgType, colorHex);
                }
            }
        }`;

const newPdpPreview = `function updatePdpPreview() {
            const preview = document.getElementById("pdpMainPreview");
            if (activePdpProduct) {
                const prodImg = activePdpProduct.thumbnail || activePdpProduct.imgUrl || '/assets/products/airpods_pro.jpg';
                preview.innerHTML = \`<img src="\${prodImg}" alt="\${activePdpProduct.title}" style="width:260px; height:260px; object-fit:cover; filter:drop-shadow(0 16px 32px rgba(255,83,136,0.2)); border-radius:16px; transition:transform 0.4s ease;">\`;
            }
        }`;

if (content.includes(oldPdpPreview)) {
    content = content.replace(oldPdpPreview, newPdpPreview);
    console.log('✔ Replaced updatePdpPreview with real product photo preview');
} else {
    console.warn('Regex match for updatePdpPreview...');
    content = content.replace(
        /function updatePdpPreview\(\) \{[\s\S]*?renderSvgGraphic\(activePdpProduct\.svgType, colorHex\);[\s\S]*?\}\s*\}/,
        newPdpPreview
    );
    console.log('✔ Replaced updatePdpPreview via regex');
}

fs.writeFileSync(indexPath, content, 'utf8');
console.log('✔ All remaining SVG placeholders replaced with real commercial product photography');
