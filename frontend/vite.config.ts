import { defineConfig, loadEnv, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const useHttps = mode === 'development' && env.VITE_USE_HTTPS === 'true'

  const plugins: PluginOption[] = [react()]

  if (useHttps) {
    const mkcert = (await import('vite-plugin-mkcert')).default
    plugins.push(mkcert({ hosts: ['localhost', '127.0.0.1'] }))
  }

  return {
    plugins,
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
