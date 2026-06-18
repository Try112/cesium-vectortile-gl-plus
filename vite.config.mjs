import { defineConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'
import license from 'vite-plugin-license'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'Source')
    }
  },
  define: {
    'process.env': {}
  },
  build: {
    outDir: './dist',
    lib: {
      entry: path.resolve(__dirname, 'index.js'),
      name: 'CVT',
      fileName(format) {
        if (format == 'es') {
          return 'cvt-gl.js'
        } else {
          return 'cvt-gl.min.js'
        }
      }
    },
    sourcemap: true
  },
  esbuild: {
    drop: ['debugger']
  },
  plugins: [
    license({
      thirdParty: {
        output: './dist/THIRD-PARTY-LICENSES.txt'
      }
    })
  ]
})
