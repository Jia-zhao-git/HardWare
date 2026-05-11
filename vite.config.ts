import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  base: "./",
  server: {
    port: 5173,
    strictPort: false,
    host: false,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // 优先检查特定包，避免循环依赖
            if (id.includes('recharts')) return 'recharts'
            if (id.includes('lucide-react')) return 'icons'
            if (id.includes('dayjs')) return 'dayjs'
            // react 生态统一打包
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react-vendor'
            // 其他依赖统一放入 vendor
            return 'vendor'
          }
        },
      },
    },
    chunkSizeWarningLimit: 800,
    // 生产环境优化：减少不必要的代码生成
    sourcemap: false,
    minify: 'esbuild',
  },
});
