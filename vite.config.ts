import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { existsSync, readFileSync } from 'node:fs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    https: existsSync('./certs/local-dev/server-key.pem') && existsSync('./certs/local-dev/server-cert.pem') ? {
      key: readFileSync('./certs/local-dev/server-key.pem'),
      cert: readFileSync('./certs/local-dev/server-cert.pem'),
    } : undefined,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4001',
        configure(proxy) {
          proxy.on('proxyReq', (proxyRequest, request) => {
            proxyRequest.setHeader('x-forwarded-for', request.socket.remoteAddress ?? '')
          })
        },
      },
      '/health': 'http://127.0.0.1:4001',
    },
  },
})
