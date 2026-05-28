import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  esbuild: {
    // Strip noisy dev logging from production bundles. console.warn / console.error
    // are intentionally KEPT so production issues remain diagnosable.
    pure: ['console.log', 'console.info', 'console.debug'],
  },
  build: {
    // The app is a single large App.jsx (~9.5k lines). Vendor deps are split out below;
    // the remaining app chunk is ~865 kB (≈235 kB gzip). Further reduction needs route-level
    // React.lazy code-splitting — tracked as a follow-up, not required for launch.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Split heavy third-party deps out of the main app chunk for faster first paint
        // and better long-term caching (vendor code changes far less often than app code).
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'supabase':     ['@supabase/supabase-js'],
          'charts':       ['recharts'],
        },
      },
    },
  },
})
