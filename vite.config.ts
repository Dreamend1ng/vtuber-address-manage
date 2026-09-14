import vue from '@vitejs/plugin-vue'
import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite'

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Element Plus / Vue 会使用内联 style 属性
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // 收集表单需要访问 GitHub API 读写提交，以及查询提交者 IP 归属地
  "connect-src 'self' https://api.github.com https://ipwho.is https://api.vore.top https://ipinfo.io",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

/**
 * 在构建产物里注入 CSP。
 * GitHub Pages 无法自定义 HTTP 头，meta 标签是最接近的替代方案；
 * 只在构建时注入，避免影响开发服务器的 HMR。
 */
function cspMeta(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(): HtmlTagDescriptor[] {
        return [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
            injectTo: 'head',
          },
        ]
      },
    },
  }
}

export default defineConfig({
  // 相对路径：无论部署在域名根目录还是 GitHub Pages 的子路径下都能直接工作
  base: './',
  plugins: [vue(), cspMeta()],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
})
