import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import packageJson from './package.json' with {type: 'json'}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
})
