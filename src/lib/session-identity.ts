// A different account must never reuse another account's mounted dashboard state.
// Token refreshes and repeated SIGNED_IN events for the same account are harmless.
export function createSessionIdentityGuard() {
  let initialized = false
  let currentId: string | null = null
  return (user: {id: string} | null | undefined) => {
    const nextId = user?.id ?? null
    const changed = initialized && currentId !== nextId
    initialized = true
    currentId = nextId
    return changed
  }
}
