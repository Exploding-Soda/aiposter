import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const proxyTarget =
      env.VITE_BACKEND_PROXY_TARGET ||
      (env.VITE_BACKEND_API && env.VITE_BACKEND_API.startsWith('http')
        ? env.VITE_BACKEND_API
        : 'http://localhost:8001');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/api': {
            target: proxyTarget,
            changeOrigin: true,
            secure: false,
            rewrite: (path) => path.replace(/^\/api/, '')
          }
        }
      },
      plugins: [react()],
      define: {
        "process.env.POLOAPI_APIKEY": JSON.stringify(env.POLOAPI_APIKEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
