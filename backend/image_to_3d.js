/**
 * POP CARTY — AUTOMATIC AI IMAGE-TO-3D GENERATION ENGINE
 * 
 * Official Meshy API v1/v2 Integration (Image-to-3D & Multi-Image-to-3D)
 * 
 * STRICT ARCHITECTURE RULES:
 *   1. Real Meshy Image-to-3D API is used for AI generation.
 *   2. Procedural / primitive Three.js geometry is NEVER used for products.
 *   3. If MESHY_API_KEY is missing, stop immediately and report:
 *      "AI 3D generation requires a Meshy API key."
 *   4. Existing product images on disk are automatically loaded and sent.
 *   5. Only real, validated GLBs are attached with status = 'ready'.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

// Zero-dependency .env loader
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    try {
        const envContent = fs.readFileSync(envPath, 'utf8');
        for (const line of envContent.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx !== -1) {
                const key = trimmed.slice(0, eqIdx).trim();
                const val = trimmed.slice(eqIdx + 1).trim();
                if (process.env[key] === undefined || process.env[key] === '') {
                    process.env[key] = val;
                }
            }
        }
    } catch (e) {
        console.warn('[3D Engine] Warning: Could not read .env file:', e.message);
    }
}

const MODELS_DIR = path.join(__dirname, 'assets', 'models');
if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
}

// Real backend states per requirement
const STATUS = {
    IDLE: 'idle',
    PREPARING: 'preparing',
    UPLOADING: 'uploading',
    SUBMITTED: 'submitted',
    GENERATING: 'generating',
    TEXTURING: 'texturing',
    DOWNLOADING: 'downloading',
    VALIDATING: 'validating',
    READY: 'ready',
    FAILED: 'failed'
};

// In-memory progress tracker for real-time polling
const generationStates = new Map();

/**
 * Server-side diagnostics logging
 * Never prints actual API keys!
 */
function logDiagnostic(step, data = {}) {
    const timestamp = new Date().toISOString();
    const formatted = Object.entries(data)
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join(' | ');
    console.log(`[3D Diagnostics][${timestamp}] [${step}] ${formatted}`);
}

/**
 * Get current generation status for a product
 */
function getProduct3DStatus(productId) {
    const id = parseInt(productId, 10);
    return generationStates.get(id) || {
        productId: id,
        status: STATUS.IDLE,
        progress: 0,
        message: 'No 3D model generated yet',
        glbUrl: null,
        updatedAt: Date.now()
    };
}

/**
 * Set generation status (in-memory + optional DB sync)
 */
function setProduct3DStatus(productId, status, progress, message, glbUrl = null) {
    const id = parseInt(productId, 10);
    const state = {
        productId: id,
        status,
        progress: Math.min(100, Math.max(0, progress)),
        message,
        glbUrl,
        updatedAt: Date.now()
    };
    generationStates.set(id, state);
    return state;
}

/**
 * Sync generation status to database
 */
async function syncStatusToDb(productId, status, glbUrl, db) {
    if (!db) return;
    const id = parseInt(productId, 10);
    try {
        const enableVal = (status === STATUS.READY && glbUrl) ? 1 : 0;
        const sql = `
            UPDATE products
            SET generation_status_3d = ?, glb_url = ?, enable_3d = ?, updated_at = CURRENT_TIMESTAMP
            WHERE product_id = ?
        `;
        if (db.run) {
            await db.run(sql, [status, glbUrl, enableVal, id]);
        } else if (db.prepare) {
            db.prepare(sql).run(status, glbUrl, enableVal, id);
        }
    } catch (e) {
        console.error(`[3D Engine] DB sync error for product ${id}:`, e.message);
    }
}

/**
 * Convert local image file to Base64 data URI
 */
function fileToDataUri(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`File does not exist: ${filePath}`);
    }
    const ext = path.extname(filePath).toLowerCase();
    let mime = 'image/jpeg';
    if (ext === '.png') mime = 'image/png';
    else if (ext === '.webp') mime = 'image/webp';
    else if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';

    const buf = fs.readFileSync(filePath);
    return {
        dataUri: `data:${mime};base64,${buf.toString('base64')}`,
        mime,
        sizeBytes: buf.length
    };
}

// ─────────────────────────────────────────────────────────
//  REAL MESHY IMAGE-TO-3D API INTEGRATION
// ─────────────────────────────────────────────────────────

/**
 * Submit image(s) to Meshy Image-to-3D API
 * Uses official Meshy OpenAPI endpoints:
 *   - Single Image: POST https://api.meshy.ai/openapi/v1/image-to-3d
 *   - Multi Image:  POST https://api.meshy.ai/openapi/v1/multi-image-to-3d
 * 
 * @param {string[]} imagePaths - Local file paths of 1 to 4 images
 * @param {string} apiKey - Meshy API key
 * @param {object} options - Generation options (topology, polycount, etc.)
 * @returns {Promise<{taskId: string, isMulti: boolean}>}
 */
async function meshySubmitTask(imagePaths, apiKey, options = {}) {
    return new Promise((resolve, reject) => {
        if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
            return reject(new Error('AI 3D generation requires a Meshy API key.'));
        }

        const isMulti = imagePaths.length > 1;
        const apiPath = isMulti ? '/openapi/v1/multi-image-to-3d' : '/openapi/v1/image-to-3d';

        let payload;
        if (isMulti) {
            const urls = [];
            for (let i = 0; i < Math.min(imagePaths.length, 4); i++) {
                const info = fileToDataUri(imagePaths[i]);
                urls.push(info.dataUri);
            }
            payload = {
                image_urls: urls,
                enable_pbr: true,
                should_remesh: true,
                should_texture: true,
                target_polycount: options.polycount || 30000,
                ai_model: 'meshy-4'
            };
        } else {
            const info = fileToDataUri(imagePaths[0]);
            payload = {
                image_url: info.dataUri,
                enable_pbr: true,
                should_remesh: true,
                should_texture: true,
                target_polycount: options.polycount || 30000,
                ai_model: 'meshy-4'
            };
        }

        const postData = JSON.stringify(payload);

        logDiagnostic('Meshy Request Started', {
            endpoint: `https://api.meshy.ai${apiPath}`,
            isMulti,
            imageCount: isMulti ? payload.image_urls.length : 1,
            payloadBytes: Buffer.byteLength(postData)
        });

        const req = https.request({
            hostname: 'api.meshy.ai',
            port: 443,
            path: apiPath,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey.trim()}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'User-Agent': 'PopCarty-ECommerce/2.0'
            },
            timeout: 60000
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                logDiagnostic('Meshy Response Received', {
                    statusCode: res.statusCode,
                    responseLength: body.length
                });

                try {
                    const data = JSON.parse(body);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        const taskId = data.result || data.id || data.task_id;
                        if (!taskId) {
                            return reject(new Error('Meshy response did not contain a valid task ID: ' + body.slice(0, 200)));
                        }
                        logDiagnostic('Meshy Task Created', { taskId, isMulti });
                        resolve({ taskId, isMulti });
                    } else {
                        const errMsg = data.message || data.error || `Meshy API HTTP ${res.statusCode}`;
                        reject(new Error(`Meshy API Error (${res.statusCode}): ${errMsg}`));
                    }
                } catch (e) {
                    reject(new Error(`Meshy response parse error: ${e.message} (Raw: ${body.slice(0, 150)})`));
                }
            });
        });

        req.on('error', (e) => reject(new Error(`Meshy network error: ${e.message}`)));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Meshy API request timed out (60s)'));
        });

        req.write(postData);
        req.end();
    });
}

/**
 * Poll Meshy task status until completion or failure
 * Reports real provider progress and state
 */
async function meshyPollTask(taskId, apiKey, isMulti = false, onProgress = null, maxAttempts = 120, intervalMs = 6000) {
    const apiPath = isMulti ? `/openapi/v1/multi-image-to-3d/${taskId}` : `/openapi/v1/image-to-3d/${taskId}`;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise(r => setTimeout(r, intervalMs));

        const result = await new Promise((resolve, reject) => {
            const req = https.get({
                hostname: 'api.meshy.ai',
                port: 443,
                path: apiPath,
                headers: {
                    'Authorization': `Bearer ${apiKey.trim()}`,
                    'User-Agent': 'PopCarty-ECommerce/2.0'
                },
                timeout: 20000
            }, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        resolve({ statusCode: res.statusCode, data });
                    } catch (e) {
                        reject(new Error(`Poll response parse error: ${e.message}`));
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Poll request timed out'));
            });
        });

        const data = result.data;
        const taskStatus = (data.status || '').toUpperCase();
        const progressNum = typeof data.progress === 'number' ? data.progress : Math.round((attempt / maxAttempts) * 100);

        logDiagnostic('Meshy Polling Status', {
            taskId,
            attempt,
            providerStatus: taskStatus,
            progress: progressNum
        });

        if (taskStatus === 'SUCCEEDED') {
            const glbUrl = data.model_urls?.glb || data.model_url || data.output?.model;
            if (glbUrl) {
                logDiagnostic('Meshy Generation Succeeded', { taskId, glbUrl });
                if (onProgress) {
                    onProgress({
                        status: STATUS.DOWNLOADING,
                        progress: 90,
                        message: 'Downloading GLB...'
                    });
                }
                return glbUrl;
            }
            throw new Error('Meshy status is SUCCEEDED but no GLB model URL was found in response');
        }

        if (taskStatus === 'FAILED' || taskStatus === 'EXPIRED') {
            const failReason = data.task_error?.message || data.message || 'Unknown provider error';
            logDiagnostic('Meshy Generation Failed', { taskId, failReason });
            throw new Error(`Meshy 3D generation failed: ${failReason}`);
        }

        // Real in-progress state mapping
        if (onProgress) {
            let currentStatus = STATUS.GENERATING;
            let currentMsg = 'AI generating geometry...';

            if (progressNum >= 60) {
                currentStatus = STATUS.TEXTURING;
                currentMsg = 'Generating textures...';
            }

            onProgress({
                status: currentStatus,
                progress: Math.min(88, Math.max(30, progressNum)),
                message: currentMsg
            });
        }
    }

    throw new Error(`Meshy generation timed out after ${maxAttempts * (intervalMs / 1000)} seconds.`);
}

/**
 * Download a remote GLB file to local storage
 */
async function downloadGlbFile(url, outputPath) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, { timeout: 120000 }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return downloadGlbFile(res.headers.location, outputPath).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`GLB download failed with HTTP ${res.statusCode}`));
            }
            const fileStream = fs.createWriteStream(outputPath);
            res.pipe(fileStream);
            fileStream.on('finish', () => {
                fileStream.close();
                resolve(outputPath);
            });
            fileStream.on('error', (err) => {
                try { fs.unlinkSync(outputPath); } catch (e) {}
                reject(err);
            });
        }).on('error', reject);
    });
}

// ─────────────────────────────────────────────────────────
//  STRICT GLB VALIDATION
// ─────────────────────────────────────────────────────────

/**
 * Validate a GLB file for glTF 2.0 binary compliance
 * Checks:
 *   - File exists and size > 1KB
 *   - Header magic: 0x46546C67 ("glTF")
 *   - glTF version: 2
 *   - File length matches header byte length
 *   - First chunk is JSON type (0x4E4F534A)
 *   - Parsed JSON contains valid glTF asset version 2.0
 *   - Valid meshes array exists and is not empty
 *   - Rejects HTML error pages or JSON error strings pretending to be GLB
 */
function validateGlbFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return { valid: false, reason: 'GLB file does not exist on disk' };
    }

    const stats = fs.statSync(filePath);
    if (stats.size < 1024) {
        return { valid: false, reason: `File is too small (${stats.size} bytes). Real GLBs are typically > 50KB.` };
    }

    const buf = fs.readFileSync(filePath);

    // Check if file is HTML error page
    const prefixStr = buf.slice(0, 100).toString('utf8').trim().toLowerCase();
    if (prefixStr.startsWith('<!doctype html') || prefixStr.startsWith('<html') || prefixStr.startsWith('<?xml')) {
        return { valid: false, reason: 'File is an HTML error page, not a binary GLB' };
    }

    // Check magic bytes: 0x46546C67 = "glTF"
    const magic = buf.readUInt32LE(0);
    if (magic !== 0x46546C67) {
        return { valid: false, reason: `Invalid GLB magic header (expected 0x46546c67, got 0x${magic.toString(16)})` };
    }

    // Check version
    const version = buf.readUInt32LE(4);
    if (version !== 2) {
        return { valid: false, reason: `Unsupported glTF version ${version} (expected 2)` };
    }

    // Check byte length in header matches file length
    const totalLength = buf.readUInt32LE(8);
    if (totalLength !== buf.length) {
        return { valid: false, reason: `GLB byte length mismatch: header says ${totalLength}, file is ${buf.length}` };
    }

    // Check first chunk is JSON
    if (buf.length < 20) {
        return { valid: false, reason: 'GLB truncated: chunk header missing' };
    }

    const chunk0Length = buf.readUInt32LE(12);
    const chunk0Type = buf.readUInt32LE(16);
    if (chunk0Type !== 0x4E4F534A) { // "JSON"
        return { valid: false, reason: 'First chunk is not JSON type' };
    }

    // Parse glTF JSON metadata
    try {
        const jsonStr = buf.toString('utf8', 20, 20 + chunk0Length);
        const gltf = JSON.parse(jsonStr);

        if (!gltf.asset || gltf.asset.version !== '2.0') {
            return { valid: false, reason: 'Invalid glTF asset specification in JSON header' };
        }

        if (!Array.isArray(gltf.meshes) || gltf.meshes.length === 0) {
            return { valid: false, reason: 'GLB contains no meshes' };
        }

        return {
            valid: true,
            fileSize: stats.size,
            version: version,
            meshesCount: gltf.meshes.length,
            materialsCount: Array.isArray(gltf.materials) ? gltf.materials.length : 0
        };
    } catch (parseErr) {
        return { valid: false, reason: `Failed to parse glTF JSON chunk: ${parseErr.message}` };
    }
}

// ─────────────────────────────────────────────────────────
//  MAIN GENERATION PIPELINE
// ─────────────────────────────────────────────────────────

/**
 * Generate a 3D model for an existing product from its image(s).
 * 
 * Pipeline:
 *   Existing Product Image -> Backend retrieves image bytes ->
 *   Verify MESHY_API_KEY -> Submit to real Meshy API ->
 *   Receive task ID -> Poll status (generating / texturing) ->
 *   Download real GLB -> Validate GLB ->
 *   Save GLB & connect to database -> Customer viewer displays real GLB
 * 
 * @param {number} productId
 * @param {string|string[]} imagePaths - Paths to existing product images
 * @param {object} db - SQLite database handle
 * @param {object} options - Extra options
 * @returns {Promise<object>} Result
 */
async function generateProduct3DModel(productId, imagePaths, db, options = {}) {
    const id = parseInt(productId, 10);
    const startTime = Date.now();
    const rawPaths = Array.isArray(imagePaths) ? imagePaths : [imagePaths];

    try {
        // ── 1. Check API Key Configuration ──
        const meshyKey = process.env.MESHY_API_KEY ? process.env.MESHY_API_KEY.trim() : '';

        if (!meshyKey) {
            const missingMsg = 'AI 3D generation requires a Meshy API key.';
            logDiagnostic('API Key Missing', { productId: id });
            setProduct3DStatus(id, STATUS.FAILED, 0, missingMsg);
            syncStatusToDb(id, STATUS.FAILED, null, db);

            return {
                success: false,
                status: STATUS.FAILED,
                message: missingMsg,
                error: missingMsg,
                durationMs: Date.now() - startTime
            };
        }

        // ── 2. Resolve Existing Product Image Paths ──
        setProduct3DStatus(id, STATUS.PREPARING, 10, 'Preparing image...');

        const resolvedPaths = [];
        for (const p of rawPaths) {
            if (!p || typeof p !== 'string') continue;
            let resolved = p;
            if (resolved.startsWith('/') || resolved.startsWith('\\')) {
                resolved = path.join(__dirname, resolved.replace(/^[/\\]+/, ''));
            } else if (!fs.existsSync(resolved)) {
                resolved = path.join(__dirname, resolved);
            }
            if (fs.existsSync(resolved)) {
                resolvedPaths.push(resolved);
            }
        }

        if (resolvedPaths.length === 0) {
            const noImgMsg = 'Product has no existing stored image files to generate 3D model from.';
            setProduct3DStatus(id, STATUS.FAILED, 0, noImgMsg);
            syncStatusToDb(id, STATUS.FAILED, null, db);
            return { success: false, status: STATUS.FAILED, message: noImgMsg };
        }

        // Log diagnostics for primary image
        const primaryExt = path.extname(resolvedPaths[0]).toLowerCase();
        const primaryStats = fs.statSync(resolvedPaths[0]);
        logDiagnostic('Existing Product Image Resolved', {
            productId: id,
            resolvedPath: resolvedPaths[0],
            mimeType: primaryExt === '.png' ? 'image/png' : (primaryExt === '.webp' ? 'image/webp' : 'image/jpeg'),
            sizeBytes: primaryStats.size,
            totalImagesCount: resolvedPaths.length
        });

        // ── 3. Submit to Real Meshy API ──
        setProduct3DStatus(id, STATUS.UPLOADING, 20, 'Sending to Meshy...');

        const { taskId, isMulti } = await meshySubmitTask(resolvedPaths, meshyKey, {
            polycount: 30000
        });

        setProduct3DStatus(id, STATUS.SUBMITTED, 30, 'AI generating geometry...');

        // ── 4. Poll Real Meshy Task Status ──
        const glbDownloadUrl = await meshyPollTask(
            taskId,
            meshyKey,
            isMulti,
            (progressState) => {
                setProduct3DStatus(id, progressState.status, progressState.progress, progressState.message);
            }
        );

        // ── 5. Download Real Generated GLB ──
        setProduct3DStatus(id, STATUS.DOWNLOADING, 90, 'Downloading GLB...');
        const glbFileName = `product_${id}_ai_${Date.now()}.glb`;
        const glbFilePath = path.join(MODELS_DIR, glbFileName);

        logDiagnostic('GLB Download Started', { glbDownloadUrl, destination: glbFilePath });
        await downloadGlbFile(glbDownloadUrl, glbFilePath);

        const downloadedStats = fs.statSync(glbFilePath);
        logDiagnostic('GLB Download Completed', {
            fileSize: downloadedStats.size,
            filePath: glbFilePath
        });

        // ── 6. Validate GLB Integrity ──
        setProduct3DStatus(id, STATUS.VALIDATING, 95, 'Validating 3D model...');
        const validation = validateGlbFile(glbFilePath);

        if (!validation.valid) {
            logDiagnostic('GLB Validation Failed', { reason: validation.reason });
            try { fs.unlinkSync(glbFilePath); } catch (e) {}

            const valMsg = `Generated GLB failed validation: ${validation.reason}`;
            setProduct3DStatus(id, STATUS.FAILED, 0, valMsg);
            syncStatusToDb(id, STATUS.FAILED, null, db);

            return {
                success: false,
                status: STATUS.FAILED,
                message: valMsg,
                durationMs: Date.now() - startTime
            };
        }

        // ── 7. Save GLB URL to Database & Enable 3D ──
        const glbPublicUrl = `/assets/models/${glbFileName}`;

        if (db) {
            const sql = `
                UPDATE products
                SET glb_url = ?, enable_3d = 1, generation_status_3d = 'ready', updated_at = CURRENT_TIMESTAMP
                WHERE product_id = ?
            `;
            if (db.run) {
                await db.run(sql, [glbPublicUrl, id]);
            } else if (db.prepare) {
                db.prepare(sql).run(glbPublicUrl, id);
            }
        }

        const duration = Date.now() - startTime;
        logDiagnostic('Pipeline Success', {
            productId: id,
            glbPublicUrl,
            fileSize: validation.fileSize,
            durationSeconds: (duration / 1000).toFixed(1)
        });

        const finalState = setProduct3DStatus(
            id,
            STATUS.READY,
            100,
            '3D model ready.',
            glbPublicUrl
        );

        return {
            success: true,
            status: STATUS.READY,
            glbUrl: glbPublicUrl,
            fileSize: validation.fileSize,
            durationMs: duration,
            state: finalState
        };

    } catch (err) {
        logDiagnostic('Pipeline Error', { productId: id, error: err.message });
        setProduct3DStatus(id, STATUS.FAILED, 0, `3D generation failed: ${err.message}`);
        await syncStatusToDb(id, STATUS.FAILED, null, db);
        return {
            success: false,
            status: STATUS.FAILED,
            message: err.message,
            error: err.message,
            durationMs: Date.now() - startTime
        };
    }
}

// ─────────────────────────────────────────────────────────
//  ADMIN MANAGEMENT FUNCTIONS
// ─────────────────────────────────────────────────────────

/**
 * Delete 3D model file and reset database
 */
async function deleteProduct3DModel(productId, db) {
    const id = parseInt(productId, 10);
    let row = null;
    if (db.get) {
        row = await db.get('SELECT glb_url FROM products WHERE product_id = ?', [id]);
    } else if (db.prepare) {
        row = db.prepare('SELECT glb_url FROM products WHERE product_id = ?').get(id);
    }

    if (row && row.glb_url) {
        const filePath = path.join(__dirname, row.glb_url.replace(/^\//, ''));
        if (fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (e) {}
        }
    }

    const sql = `
        UPDATE products
        SET glb_url = NULL, enable_3d = 0, generation_status_3d = 'none', updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ?
    `;
    if (db.run) {
        await db.run(sql, [id]);
    } else if (db.prepare) {
        db.prepare(sql).run(id);
    }

    generationStates.delete(id);
    logDiagnostic('3D Model Deleted', { productId: id });
    return { success: true, message: '3D model deleted successfully' };
}

/**
 * Toggle 3D display for a product
 */
async function toggleProduct3D(productId, enable, db) {
    const id = parseInt(productId, 10);
    const val = enable ? 1 : 0;
    const sql = `UPDATE products SET enable_3d = ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ?`;
    if (db.run) {
        await db.run(sql, [val, id]);
    } else if (db.prepare) {
        db.prepare(sql).run(val, id);
    }
    logDiagnostic('3D Display Toggled', { productId: id, enable: val });
    return { success: true, enable_3d: val };
}

/**
 * Save an admin-uploaded replacement GLB (validating it first)
 */
async function saveUploadedGlb(productId, glbBuffer, db) {
    const id = parseInt(productId, 10);

    const tempPath = path.join(MODELS_DIR, `temp_upload_${id}_${Date.now()}.glb`);
    fs.writeFileSync(tempPath, glbBuffer);

    const validation = validateGlbFile(tempPath);
    if (!validation.valid) {
        try { fs.unlinkSync(tempPath); } catch (e) {}
        return { success: false, message: `Invalid GLB file: ${validation.reason}` };
    }

    // Delete old model if exists
    let oldRow = null;
    if (db.get) {
        oldRow = await db.get('SELECT glb_url FROM products WHERE product_id = ?', [id]);
    } else if (db.prepare) {
        oldRow = db.prepare('SELECT glb_url FROM products WHERE product_id = ?').get(id);
    }
    if (oldRow && oldRow.glb_url) {
        const oldPath = path.join(__dirname, oldRow.glb_url.replace(/^\//, ''));
        if (fs.existsSync(oldPath)) {
            try { fs.unlinkSync(oldPath); } catch (e) {}
        }
    }

    const finalName = `product_${id}_manual_${Date.now()}.glb`;
    const finalPath = path.join(MODELS_DIR, finalName);
    fs.renameSync(tempPath, finalPath);

    const publicUrl = `/assets/models/${finalName}`;
    const sql = `
        UPDATE products
        SET glb_url = ?, enable_3d = 1, generation_status_3d = 'ready', updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ?
    `;
    if (db.run) {
        await db.run(sql, [publicUrl, id]);
    } else if (db.prepare) {
        db.prepare(sql).run(publicUrl, id);
    }

    setProduct3DStatus(id, STATUS.READY, 100, '3D model ready.', publicUrl);
    logDiagnostic('Manual GLB Uploaded', { productId: id, publicUrl, fileSize: validation.fileSize });

    return {
        success: true,
        glbUrl: publicUrl,
        fileSize: validation.fileSize,
        message: 'GLB model uploaded and validated successfully'
    };
}

module.exports = {
    STATUS,
    MODELS_DIR,
    logDiagnostic,
    getProduct3DStatus,
    setProduct3DStatus,
    syncStatusToDb,
    fileToDataUri,
    validateGlbFile,
    meshySubmitTask,
    meshyPollTask,
    downloadGlbFile,
    generateProduct3DModel,
    deleteProduct3DModel,
    toggleProduct3D,
    saveUploadedGlb
};
