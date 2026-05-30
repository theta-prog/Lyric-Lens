const SONGLE_HOST_SUFFIX = 'songle.jp'

function isSupportedSongleHost(hostname) {
  return hostname === SONGLE_HOST_SUFFIX || hostname.endsWith(`.${SONGLE_HOST_SUFFIX}`)
}

function createResponse(body, init = {}) {
  return new Response(body, {
    ...init,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      ...(init.headers ?? {}),
    },
  })
}

export async function onRequest(context) {
  const { request } = context

  if (request.method === 'OPTIONS') {
    return createResponse(null, { status: 204 })
  }

  if (request.method !== 'GET') {
    return createResponse('Method not allowed', { status: 405 })
  }

  const requestUrl = new URL(request.url)
  const proxiedPath = requestUrl.pathname.replace(/^\/__songle_proxy\//, '')
  const firstSlash = proxiedPath.indexOf('/')

  if (firstSlash < 0) {
    return createResponse('Invalid Songle proxy path', { status: 400 })
  }

  const targetHost = proxiedPath.slice(0, firstSlash)

  if (!isSupportedSongleHost(targetHost)) {
    return createResponse('Unsupported Songle host', { status: 400 })
  }

  const targetPath = proxiedPath.slice(firstSlash)
  const upstream = await fetch(`https://${targetHost}${targetPath}${requestUrl.search}`, {
    headers: {
      accept: request.headers.get('accept') ?? 'application/json',
    },
  })

  const headers = new Headers()
  const contentType = upstream.headers.get('content-type')
  const cacheControl = upstream.headers.get('cache-control')

  if (contentType) {
    headers.set('content-type', contentType)
  }

  headers.set('cache-control', cacheControl ?? 'public, max-age=300')

  return createResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  })
}
