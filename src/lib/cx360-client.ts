/** Ends the loading state even when authentication or the network never settles. */
export async function withCxDeadline<T>(operation: PromiseLike<T>, milliseconds = 20000, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.()
          reject(new Error('A consulta demorou mais que o esperado. Tente novamente. Se você estava salvando, consulte os acompanhamentos antes de repetir o envio.'))
        }, milliseconds)
      }),
    ])
  } finally { if (timer !== undefined) clearTimeout(timer) }
}

export async function readCxResponse(response: Response): Promise<unknown> {
  let payload: unknown
  try { payload = await response.json() } catch {
    throw new Error('O serviço respondeu de forma inesperada. Tente novamente em instantes.')
  }
  if (!response.ok) {
    const error = payload && typeof payload === 'object' && 'erro' in payload ? payload.erro : undefined
    throw new Error(typeof error === 'string' ? error : 'Consulta indisponível. Tente novamente.')
  }
  return payload
}
