const fs = require('fs');
const path = require('path');
const https = require('https');

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const FILES = [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'model.onnx',
    'model_quantized.onnx',
    'special_tokens_map.json',
    'vocab.txt'
];

const TARGET_DIR = path.join(__dirname, '..', 'resources', 'models', 'Xenova', 'all-MiniLM-L6-v2');

if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
}

const { execSync } = require('child_process');

const downloadFile = (file) => {
    // Use HuggingFace mirror for better connectivity in China
    // Note: For Xenova/all-MiniLM-L6-v2, the onnx files are at the root, BUT sometimes CDN links vary.
    // Wait, checked the repo structure: https://huggingface.co/Xenova/all-MiniLM-L6-v2/tree/main
    // The files are indeed at root. 
    // However, HF-Mirror sometimes has issues with LFS files directly via resolve/main.
    // Let's try to handle the 'onnx' extension specifically if needed, but for Xenova/all-MiniLM-L6-v2 they are root.
    // Maybe try 'onnx/model.onnx' if root fails? No, the repo structure is flat.
    // Actually, Xenova/all-MiniLM-L6-v2 usually has model.onnx.
    // Let's try to add -L to follow redirects (already did).
    
    // Fallback URL logic?
    // Let's try downloading from the official HF via a proxy if mirror fails? 
    // Or maybe the file name is slightly different?
    // Checking repo: model.onnx and model_quantized.onnx exist.
    
    // Let's try a different mirror URL format if possible or just retry.
    // For now, let's keep the URL but maybe the mirror returns 404 for LFS temporarily?
    // Let's try "https://huggingface.co/..." directly if mirror fails, assuming user might have proxy?
    // But user is likely in CN.
    
    // Another possibility: The files are actually in a subfolder 'onnx' in newer versions?
    // Let's check 'onnx/model.onnx' just in case.
    
    let url = `https://hf-mirror.com/${MODEL_ID}/resolve/main/${file}`;
    
    // Xenova models sometimes organize as onnx/model.onnx.
    // But all-MiniLM-L6-v2 is usually flat.
    // Let's add a fallback logic.
    
    const dest = path.join(TARGET_DIR, file);

    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
        console.log(`Skipping ${file} (already exists and not empty)`);
        return Promise.resolve();
    }

    console.log(`Downloading ${file} using curl...`);
    return new Promise((resolve, reject) => {
        try {
            execSync(`curl -L -f -o "${dest}" "${url}"`, { stdio: 'inherit' });
            console.log(`Downloaded ${file}`);
            resolve();
        } catch (e) {
            console.warn(`Failed to download ${file} from root, trying 'onnx/' subfolder...`);
            try {
                // Try subfolder onnx/ (Some Xenova models structure change)
                const subUrl = `https://hf-mirror.com/${MODEL_ID}/resolve/main/onnx/${file}`;
                execSync(`curl -L -f -o "${dest}" "${subUrl}"`, { stdio: 'inherit' });
                console.log(`Downloaded ${file} from onnx/ subfolder`);
                resolve();
            } catch (e2) {
                 console.error(`Failed to download ${file} from both locations:`, e2.message);
                 if (fs.existsSync(dest)) fs.unlinkSync(dest);
                 reject(e2);
            }
        }
    });
};

async function downloadAll() {
    console.log(`Starting download for ${MODEL_ID} to ${TARGET_DIR}...`);
    for (const file of FILES) {
        try {
            await downloadFile(file);
        } catch (e) {
            console.error(`Error downloading ${file}:`, e.message);
        }
    }
    console.log("Download complete.");
}

downloadAll();