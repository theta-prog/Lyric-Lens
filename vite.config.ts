import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const songleDevProxy = (): Plugin => ({
  name: 'songle-dev-proxy',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/__songle_proxy/')) {
        next()
        return
      }

      try {
        const requestUrl = new URL(req.url, 'http://localhost')
        const proxiedPath = requestUrl.pathname.replace(/^\/__songle_proxy\//, '')
        const firstSlash = proxiedPath.indexOf('/')

        if (firstSlash < 0) {
          res.statusCode = 400
          res.end('Invalid Songle proxy path')
          return
        }

        const targetHost = proxiedPath.slice(0, firstSlash)
        if (!targetHost.endsWith('songle.jp')) {
          res.statusCode = 400
          res.end('Unsupported Songle host')
          return
        }

        const targetPath = proxiedPath.slice(firstSlash)
        const upstream = await fetch(`https://${targetHost}${targetPath}${requestUrl.search}`)

        res.statusCode = upstream.status

        const contentType = upstream.headers.get('content-type')
        if (contentType) {
          res.setHeader('content-type', contentType)
        }

        const cacheControl = upstream.headers.get('cache-control')
        if (cacheControl) {
          res.setHeader('cache-control', cacheControl)
        }

        res.end(Buffer.from(await upstream.arrayBuffer()))
      } catch (error) {
        next(error as Error)
      }
    })
  },
})

export default defineConfig({
  plugins: [react(), songleDevProxy()],
  optimizeDeps: {
    include: ['textalive-app-api'],
  },
})
