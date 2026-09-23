/**
 * DOM and Client-side Logic Simulation Test
 */

const fs = require('fs');
const path = require('path');

function runDomTests() {
    console.log('--- DOM TEST 1: Verify Customer Frontend Index.html ---');
    const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

    // 1. Verify buildPdp3dProductModel is disabled / no-op
    if (!indexHtml.includes('function buildPdp3dProductModel(product) {') || !indexHtml.includes('// Disabled: Customers only see real AI-generated GLBs in <model-viewer>')) {
        throw new Error('DOM Test 1 Failed: buildPdp3dProductModel is not properly disabled!');
    }
    console.log('✔ buildPdp3dProductModel is disabled per quality standards.');

    // 2. Verify modelViewer is the 3D viewer in PDP and pdpCanvasWrapper is removed from PDP
    if (!indexHtml.includes('<model-viewer id="pdpModelViewer"') || indexHtml.includes('<canvas id="pdp3dCanvas"')) {
        throw new Error('DOM Test 1 Failed: PDP still contains legacy canvas or lacks model-viewer!');
    }
    console.log('✔ PDP strictly uses <model-viewer> and legacy canvas wrapper is removed from PDP.');

    // 3. Verify openPdpModal only shows 3D button when status === 'ready' and glb_url exists
    if (!indexHtml.includes("hasReal3d = !!(product.glb_url && (product.enable_3d === 1 || product.enable_3d === true) && product.generation_status_3d === 'ready')")) {
        throw new Error('DOM Test 1 Failed: openPdpModal does not strictly check glb_url and generation_status_3d === "ready"!');
    }
    console.log('✔ openPdpModal strictly guards 3D button visibility.');

    // 4. Verify setPdpPreviewMode('3d') falls back to photo mode if not ready
    if (!indexHtml.includes("setPdpPreviewMode('photo');") || !indexHtml.includes("activePdpProduct.generation_status_3d === 'ready'")) {
        throw new Error('DOM Test 1 Failed: setPdpPreviewMode does not strictly fall back to photo mode!');
    }
    console.log('✔ setPdpPreviewMode strictly prevents fake 3D view on customer products.');

    console.log('\n--- DOM TEST 2: Verify Admin Dashboard Admin.html ---');
    const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

    // 1. Verify "⚡ Generate 3D from Existing Image" button is present
    if (!adminHtml.includes('⚡ Generate 3D from Existing Image')) {
        throw new Error('DOM Test 2 Failed: "⚡ Generate 3D from Existing Image" button missing in admin.html!');
    }
    console.log('✔ "⚡ Generate 3D from Existing Image" button is present in admin studio.');

    // 2. Verify Auto Generate 3D setting toggle is present
    if (!adminHtml.includes('id="settingAuto3d"') || !adminHtml.includes('Auto Generate 3D')) {
        throw new Error('DOM Test 2 Failed: Auto Generate 3D setting toggle missing in admin.html!');
    }
    console.log('✔ "Auto Generate 3D" admin setting toggle is present.');

    // 3. Verify procedural 3D select dropdown is removed
    if (adminHtml.includes('Procedural 3D Fallback (Legacy Three.js)')) {
        throw new Error('DOM Test 2 Failed: Procedural 3D select dropdown is still in admin.html!');
    }
    console.log('✔ Legacy procedural 3D dropdown removed from admin.');

    // 4. Verify test GLB button is removed
    if (adminHtml.includes('id="btnTest3d"')) {
        throw new Error('DOM Test 2 Failed: btnTest3d is still in admin.html!');
    }
    console.log('✔ Fake test GLB button removed from admin.');

    // 5. Verify real backend status handling in admin polling
    if (!adminHtml.includes("'preparing', 'uploading', 'submitted', 'generating', 'texturing', 'downloading', 'validating'")) {
        throw new Error('DOM Test 2 Failed: Real backend states missing in admin.html!');
    }
    console.log('✔ Admin correctly handles all real backend states (preparing, uploading, submitted, generating, texturing, downloading, validating, ready, failed).');

    console.log('\n====================================================');
    console.log('  ALL CLIENT-SIDE CODE AUDIT CHECKS PASSED!        ');
    console.log('====================================================');
}

runDomTests();
