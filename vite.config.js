import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Make Node's global and process available for libraries like mdb-reader
    global: 'globalThis',
    'process.env': {},
  },
  resolve: {
    alias: {
      // Map modules to browser-compatible polyfills
      buffer: 'buffer',
      stream: 'stream-browserify',
      events: 'events',
      process: 'process/browser',
    },
  },
  optimizeDeps: {
    include: ['buffer', 'stream-browserify', 'events', 'process'],
  },
})
