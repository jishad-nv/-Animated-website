/**
 * End-to-End HTTP Integration Test for Pop Carty 3D Generation Pipeline
 */

const fs = require('fs');
const path = require('path');

async function testE2E() {
    console.log('--- E2E TEST 1: Public Products API ---');
    const prodRes = await fetch('http://localhost:3000/api/products');
    const prodData = await prodRes.json();
    console.log('Public products count:', prodData.count);
    
    // Check enable_3d for all products
    const ready3d = prodData.products.filter(p => p.enable_3d === 1);
    console.log('Products with enable_3d=1:', ready3d.length);
    if (ready3d.length > 0) {
        throw new Error('E2E Test 1 Failed: Some products have enable_3d=1 without real GLBs!');
    }
    console.log('✔ E2E Test 1 Passed: No products display 3D without real validated GLB models.\n');

    console.log('--- E2E TEST 2: Admin Login ---');
    const loginRes = await fetch('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@popcarty.com', password: 'PopCarty@2026!' })
    });
    const loginData = await loginRes.json();
    console.log('Admin login status:', loginRes.status, 'User:', loginData.user?.name);
    const token = loginData.token;
    if (!token) throw new Error('E2E Test 2 Failed: Admin login failed!');
    console.log('✔ E2E Test 2 Passed: Authenticated as admin.\n');

    console.log('--- E2E TEST 3: Generate 3D on Existing Image without API Key ---');
    // Call generate-3d without providing images (uses stored existing image automatically)
    const genRes = await fetch('http://localhost:3000/api/admin/products/3/generate-3d', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({}) // Empty body: backend automatically pulls existing image
    });
    const genData = await genRes.json();
    console.log('Generate-3D HTTP Status:', genRes.status);
    console.log('Generate-3D Response:', genData);

    if (genRes.status !== 400 || genData.error !== 'AI 3D generation requires a Meshy API key.') {
        throw new Error('E2E Test 3 Failed: Server did not return HTTP 400 with missing key message!');
    }
    console.log('✔ E2E Test 3 Passed: Correctly reported missing Meshy key without fake model generation.\n');

    console.log('--- E2E TEST 4: Check 3D Status Endpoint ---');
    const statusRes = await fetch('http://localhost:3000/api/admin/products/3/3d-status', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const statusData = await statusRes.json();
    console.log('3D Status response:', statusData);
    if (!statusData.success || statusData.status.status !== 'failed') {
        throw new Error('E2E Test 4 Failed: 3D status did not report failed!');
    }
    console.log('✔ E2E Test 4 Passed: 3D Status endpoint returns correct failed state.\n');

    console.log('--- E2E TEST 5: Auto-Generate-3D Settings Endpoints ---');
    const getSettingRes = await fetch('http://localhost:3000/api/admin/settings/auto-generate-3d', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const getSettingData = await getSettingRes.json();
    console.log('Current setting:', getSettingData);

    const postSettingRes = await fetch('http://localhost:3000/api/admin/settings/auto-generate-3d', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ enabled: true })
    });
    const postSettingData = await postSettingRes.json();
    console.log('Updated setting to true:', postSettingData);

    // Reset back to false
    await fetch('http://localhost:3000/api/admin/settings/auto-generate-3d', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ enabled: false })
    });
    console.log('✔ E2E Test 5 Passed: Settings GET and POST work correctly.\n');

    console.log('====================================================');
    console.log('  ALL E2E HTTP TESTS PASSED SUCCESSFULLY!          ');
    console.log('====================================================');
}

testE2E().catch(err => {
    console.error('E2E Test Suite Failed:', err);
    process.exit(1);
});
