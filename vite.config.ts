import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    https: {
      key: readFileSync('./certs/local-dev/server-key.pem'),
      cert: readFileSync('./certs/local-dev/server-cert.pem'),
    },
    proxy: { '/api': 'http://127.0.0.1:4001', '/health': 'http://127.0.0.1:4001' },
  },
})
