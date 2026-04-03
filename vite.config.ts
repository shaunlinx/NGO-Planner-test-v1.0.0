
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: false, // Allow fallback if 5173 is taken
  },
  optimizeDeps: {
    include: ['dagre', '@xyflow/react']
  }
});
