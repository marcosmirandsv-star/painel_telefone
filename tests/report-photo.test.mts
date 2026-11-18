import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { buildEmbeddedReportPhoto } from '../src/lib/report-photo.ts'

function installPhotoBrowser(context: TestContext) {
  const properties = ['window', 'document', 'Image'] as const
  const originals = properties.map((name) => Object.getOwnPropertyDescriptor(globalThis, name))
  const drawing = new Proxy({}, { get: () => () => {} })
  const browser = {
    window: { location: { origin: 'https://reports.test' }, setTimeout, clearTimeout },
    document: { createElement: () => ({ getContext: () => drawing, toDataURL: () => 'data:image/png;base64,prepared' }) },
    Image: class {
      src = ''
      naturalWidth = 256
      naturalHeight = 256
      async decode() {}
    },
  }
  properties.forEach((name) => Object.defineProperty(globalThis, name, { value: browser[name], configurable: true }))
  context.after(() => properties.forEach((name, index) => {
    const original = originals[index]
    if (original) Object.defineProperty(globalThis, name, original)
    else Reflect.deleteProperty(globalThis, name)
  }))
}

test('a foto preparada é compartilhada entre pedidos e renovada quando a URL muda', async (context) => {
  installPhotoBrowser(context)
  let requests = 0
  context.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, options?: RequestInit) => {
    requests++
    assert.equal(options?.cache, 'force-cache')
    return new Response('image', { status: 200 })
  })
  const [first, concurrent] = await Promise.all([
    buildEmbeddedReportPhoto('/photo.png?v=1'),
    buildEmbeddedReportPhoto('/photo.png?v=1'),
  ])
  assert.equal(first, concurrent)
  assert.equal(await buildEmbeddedReportPhoto('/photo.png?v=1'), first)
  assert.equal(requests, 1)
  await buildEmbeddedReportPhoto('/photo.png?v=2')
  assert.equal(requests, 2)
})

test('a espera pela foto é cancelada e uma nova tentativa consegue carregar', { timeout: 10000 }, async (context) => {
  installPhotoBrowser(context)
  let requests = 0
  context.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, options?: RequestInit) => {
    requests++
    if (requests > 1) return new Response('image', { status: 200 })
    const signal = options?.signal
    assert.ok(signal)
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })
  })
  await assert.rejects(buildEmbeddedReportPhoto('/delayed-photo.png'), /A foto demorou para carregar/)
  assert.equal(await buildEmbeddedReportPhoto('/delayed-photo.png'), 'data:image/png;base64,prepared')
  assert.equal(requests, 2)
})
