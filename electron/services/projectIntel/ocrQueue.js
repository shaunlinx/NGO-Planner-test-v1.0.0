const { Worker } = require('worker_threads');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class OcrQueue {
  constructor({ langPath, langs }) {
    this.langPath = langPath;
    this.langs = langs || 'chi_sim+eng';
    this.worker = null;
    this.pending = new Map();
    this.queue = [];
    this.busy = false;
  }

  _ensureWorker() {
    if (this.worker) return;
    this.worker = new Worker(path.join(__dirname, 'ocrWorker.js'));
    this.worker.on('message', (msg) => {
      if (!msg || msg.type !== 'result') return;
      const { jobId, success, text, error } = msg.payload || {};
      const handlers = this.pending.get(jobId);
      if (!handlers) return;
      this.pending.delete(jobId);
      this.busy = false;
      if (success) handlers.resolve({ success: true, text: text || '' });
      else handlers.resolve({ success: false, error: error || 'OCR error' });
      this._drain();
    });
    this.worker.on('error', () => {
      this._resetWorker();
    });
    this.worker.on('exit', () => {
      this._resetWorker();
    });
  }

  _resetWorker() {
    try {
      if (this.worker) this.worker.terminate();
    } catch (e) {}
    this.worker = null;
    this.busy = false;
    const pending = Array.from(this.pending.values());
    this.pending.clear();
    for (const h of pending) {
      try {
        h.resolve({ success: false, error: 'OCR worker stopped' });
      } catch (e) {}
    }
  }

  async recognize(imagePath, options) {
    this._ensureWorker();
    const jobId = uuidv4();
    const payload = {
      jobId,
      imagePath,
      langs: (options && options.langs) || this.langs,
      langPath: (options && options.langPath) || this.langPath
    };
    const promise = new Promise((resolve) => {
      this.pending.set(jobId, { resolve });
    });
    this.queue.push(payload);
    this._drain();
    return await promise;
  }

  _drain() {
    if (!this.worker || this.busy) return;
    const next = this.queue.shift();
    if (!next) return;
    this.busy = true;
    try {
      this.worker.postMessage({ type: 'recognize', payload: next });
    } catch (e) {
      this.busy = false;
      const handlers = this.pending.get(next.jobId);
      if (handlers) {
        this.pending.delete(next.jobId);
        handlers.resolve({ success: false, error: e.message });
      }
      this._drain();
    }
  }

  async dispose() {
    this.queue = [];
    this._resetWorker();
  }
}

module.exports = OcrQueue;

