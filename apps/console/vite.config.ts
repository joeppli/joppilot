import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000
  },
  build: {
    commonjsOptions: {
      // @joppilot/contract is a pnpm-linked workspace package compiled to
      // CommonJS; rollup only converts CJS named exports under node_modules
      // by default, so the linked package must be included explicitly (value
      // imports like ZONE_MODE_MATRIX fail the production build otherwise).
      include: [/packages\/contract/, /node_modules/]
    }
  }
})
