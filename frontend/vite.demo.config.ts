// Single-file demo build for the shareable preview link:  npx vite build -c vite.demo.config.ts
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  define: { 'import.meta.env.VITE_DEMO': JSON.stringify('true') },
  resolve: {
    alias: {
      'next/link': path.resolve(__dirname, 'src/shims/next-link.tsx'),
      'next/navigation': path.resolve(__dirname, 'src/shims/next-navigation.ts'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: { outDir: 'dist-demo', chunkSizeWarningLimit: 5000 },
});
