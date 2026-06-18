import { defineConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 仅构建 Vector Tile Worker，输出到 dist/cvt-gl-worker.js */
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
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, 'Source/workers/VectorTileWorker.js'),
      name: 'VectorTileWorker',
      fileName: () => 'cvt-gl-worker.js',
      formats: ['es']
    },
    sourcemap: true
  },
  esbuild: {
    drop: ['debugger']
  }
})
