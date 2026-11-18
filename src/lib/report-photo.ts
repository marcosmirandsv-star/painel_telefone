const photoCache = new Map<string, Promise<string>>()
const photoTimeoutMs = 3000

export function buildEmbeddedReportPhoto(photoUrl?: string | null): Promise<string> {
  if (!photoUrl) return Promise.resolve('')

  const resolvedPhotoUrl = new URL(photoUrl, window.location.origin).href
  let prepared = photoCache.get(resolvedPhotoUrl)
  if (!prepared) {
    prepared = renderReportPhoto(resolvedPhotoUrl).catch((error) => {
      photoCache.delete(resolvedPhotoUrl)
      throw error
    })
    photoCache.set(resolvedPhotoUrl, prepared)
  }
  return prepared
}

async function renderReportPhoto(photoUrl: string) {
  const controller = new AbortController()
  const image = new Image()
  const cancelImage = () => { image.src = '' }
  controller.signal.addEventListener('abort', cancelImage, { once: true })
  const timeout = window.setTimeout(() => controller.abort(), photoTimeoutMs)
  let objectUrl = ''

  try {
    const response = await fetch(photoUrl, { cache: 'force-cache', signal: controller.signal })
    if (!response.ok) throw new Error('A foto cadastrada não pôde ser carregada.')

    const sourceBlob = await response.blob()
    controller.signal.throwIfAborted()
    objectUrl = URL.createObjectURL(sourceBlob)
    image.src = objectUrl
    await image.decode()
    controller.signal.throwIfAborted()

    const canvas = document.createElement('canvas')
    const size = 256
    const borderWidth = 7
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    if (!context) throw new Error('O navegador não conseguiu preparar a foto para o relatório.')

    const sourceSize = Math.min(image.naturalWidth, image.naturalHeight)
    const sourceX = (image.naturalWidth - sourceSize) / 2
    const sourceY = (image.naturalHeight - sourceSize) / 2
    context.clearRect(0, 0, size, size)
    context.save()
    context.beginPath()
    context.arc(size / 2, size / 2, size / 2 - borderWidth, 0, Math.PI * 2)
    context.clip()
    context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, borderWidth, borderWidth, size - borderWidth * 2, size - borderWidth * 2)
    context.restore()
    context.strokeStyle = '#0891b2'
    context.lineWidth = borderWidth
    context.beginPath()
    context.arc(size / 2, size / 2, size / 2 - borderWidth / 2, 0, Math.PI * 2)
    context.stroke()
    return canvas.toDataURL('image/png')
  } catch (error) {
    if (controller.signal.aborted) throw new Error('A foto demorou para carregar.')
    throw error
  } finally {
    window.clearTimeout(timeout)
    controller.signal.removeEventListener('abort', cancelImage)
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}
