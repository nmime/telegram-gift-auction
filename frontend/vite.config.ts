import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const useHttps = env.VITE_USE_HTTPS === 'true'

  return {
    plugins: [
      react(),
      useHttps && mkcert({
        hosts: ['localhost', '127.0.0.1'],
      }),
    ].filter(Boolean),
    server: {
      host: '0.0.0.0',
      proxy: useHttps ? {
        '/api': {
          target: 'http://localhost:4000',
          changeOrigin: true,
        },
        '/socket.io': {
          target: 'http://localhost:4000',
          changeOrigin: true,
          ws: true,
        },
      } : undefined,
    },
  }
})
