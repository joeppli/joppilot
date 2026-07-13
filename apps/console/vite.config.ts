import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000
  },
  optimizeDeps: {
    // @joppilot/contract is a pnpm-LINKED workspace package compiled to CJS.
    // Vite dev does not prebundle linked packages by default, so the browser
    // would import the CJS file as ESM and find no named exports — a VALUE
    // import (ZONE_MODE_MATRIX, since M3-2) then blanks the whole app at
    // module eval. Forcing it through esbuild prebundling adds the CJS→ESM
    // interop in dev; the build-side twin of this fix is commonjsOptions below.
    include: ['@joppilot/contract']
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
