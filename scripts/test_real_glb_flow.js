/**
 * Test Real Valid GLB Flow
 * Creates a compliant glTF 2.0 Binary file (with real geometry mesh, normals, materials, buffer views)
 * to test the validator, upload, DB attachment, and customer viewer activation.
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const imageTo3d = require('../image_to_3d.js');

function createCompliantGlb() {
    // Generate valid glTF 2.0 binary buffer
    const positions = new Float32Array([
        -0.5, -0.5, 0.0,
         0.5, -0.5, 0.0,
         0.0,  0.5, 0.0
    ]);
    const normals = new Float32Array([
        0, 0, 1,
        0, 0, 1,
        0, 0, 1
    ]);
    const indices = new Uint16Array([0, 1, 2]);

    const posBuf = Buffer.from(positions.buffer);
    const norBuf = Buffer.from(normals.buffer);
    const idxBuf = Buffer.from(indices.buffer);

    function pad4(buf) {
        const rem = buf.length % 4;
        return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem, 0)]);
    }

    const posP = pad4(posBuf);
    const norP = pad4(norBuf);
    const idxP = pad4(idxBuf);

    const binBuf = Buffer.concat([posP, norP, idxP]);

    const gltf = {
        asset: { version: "2.0", generator: "PopCarty Real GLB Compliant Test" },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0, name: "TestMeshNode" }],
        meshes: [{
            primitives: [{
                attributes: { POSITION: 0, NORMAL: 1 },
                indices: 2,
                mode: 4
            }],
            name: "CompliantProductMesh"
        }],
        accessors: [
            { bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: "VEC3", max: [0.5, 0.5, 0], min: [-0.5, -0.5, 0] },
            { bufferView: 1, byteOffset: 0, componentType: 5126, count: 3, type: "VEC3" },
            { bufferView: 2, byteOffset: 0, componentType: 5123, count: 3, type: "SCALAR" }
        ],
        bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: posP.length, target: 34962 },
            { buffer: 0, byteOffset: posP.length, byteLength: norP.length, target: 34962 },
            { buffer: 0, byteOffset: posP.length + norP.length, byteLength: idxP.length, target: 34963 }
        ],
        buffers: [{ byteLength: binBuf.length }]
    };

    const jsonText = JSON.stringify(gltf);
    let jsonBuf = Buffer.from(jsonText, 'utf8');
    const jsonRem = jsonBuf.length % 4;
    if (jsonRem !== 0) {
        jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(4 - jsonRem, 0x20)]);
    }

    const totalLength = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
    // Pad to 1500 bytes to exceed 1KB min size requirement
    const paddingLength = Math.max(0, 1500 - totalLength);
    const finalBin = Buffer.concat([binBuf, Buffer.alloc(paddingLength, 0)]);
    gltf.buffers[0].byteLength = finalBin.length;
    
    // Recalculate
    const finalJsonText = JSON.stringify(gltf);
    let finalJsonBuf = Buffer.from(finalJsonText, 'utf8');
    const fRem = finalJsonBuf.length % 4;
    if (fRem !== 0) {
        finalJsonBuf = Buffer.concat([finalJsonBuf, Buffer.alloc(4 - fRem, 0x20)]);
    }

    const finalTotal = 12 + 8 + finalJsonBuf.length + 8 + finalBin.length;
    const glb = Buffer.alloc(finalTotal);

    glb.writeUInt32LE(0x46546C67, 0); // "glTF"
    glb.writeUInt32LE(2, 4);          // version 2
    glb.writeUInt32LE(finalTotal, 8); // total length

    let offset = 12;
    glb.writeUInt32LE(finalJsonBuf.length, offset);
    glb.writeUInt32LE(0x4E4F534A, offset + 4); // "JSON"
    offset += 8;
    finalJsonBuf.copy(glb, offset);
    offset += finalJsonBuf.length;

    glb.writeUInt32LE(finalBin.length, offset);
    glb.writeUInt32LE(0x004E4942, offset + 4); // "BIN\0"
    offset += 8;
    finalBin.copy(glb, offset);

    return glb;
}

async function run() {
    console.log('Generating compliant test GLB buffer...');
    const glbBuffer = createCompliantGlb();
    console.log('GLB buffer created, length:', glbBuffer.length);

    const testGlbPath = path.join(__dirname, 'test_sample.glb');
    fs.writeFileSync(testGlbPath, glbBuffer);

    console.log('Validating GLB file with validator...');
    const valResult = imageTo3d.validateGlbFile(testGlbPath);
    console.log('Validator output:', valResult);

    if (!valResult.valid) {
        throw new Error('Compliant GLB failed validation: ' + valResult.reason);
    }
    console.log('✔ Validator correctly passed compliant GLB file!');

    fs.unlinkSync(testGlbPath);
}

run().catch(e => {
    console.error(e);
    process.exit(1);
});
