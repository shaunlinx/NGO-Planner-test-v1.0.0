const { parentPort } = require('worker_threads');
const path = require('path');

let tesseractWorker = null;
let activeLangs = null;
let activeLangPath = null;

const ensureWorker = async ({ langs, langPath }) => {
  if (!tesseractWorker) {
    const { createWorker } = require('tesseract.js');
    tesseractWorker = await createWorker({
      langPath,
      cachePath: path.join(langPath, '.cache'),
      logger: () => {}
    });
  }
  if (activeLangPath !== langPath || activeLangs !== langs) {
    activeLangPath = langPath;
    activeLangs = langs;
    await tesseractWorker.loadLanguage(langs);
    await tesseractWorker.initialize(langs);
  }
};

parentPort.on('message', async (msg) => {
  try {
    if (!msg || msg.type !== 'recognize') return;
    const { jobId, imagePath, langs, langPath } = msg.payload || {};
    if (!jobId || !imagePath || !langs || !langPath) {
      parentPort.postMessage({ type: 'result', payload: { jobId, success: false, error: 'Invalid payload' } });
      return;
    }
    await ensureWorker({ langs, langPath });
    const res = await tesseractWorker.recognize(imagePath);
    const text = res && res.data && typeof res.data.text === 'string' ? res.data.text : '';
    parentPort.postMessage({ type: 'result', payload: { jobId, success: true, text } });
  } catch (e) {
    const jobId = msg && msg.payload ? msg.payload.jobId : null;
    parentPort.postMessage({ type: 'result', payload: { jobId, success: false, error: e.message } });
  }
});

