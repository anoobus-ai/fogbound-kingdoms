import { defineConfig } from 'vite';

export default defineConfig({
    base: './',
    logLevel: 'warning',
    build: {
        chunkSizeWarningLimit: 2000
    }
});
