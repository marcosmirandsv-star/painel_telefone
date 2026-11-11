/** Infrastructure outages must not consume the case's evidence-validation attempts. */
export function cxRetry(code: string, attempts: number) {
  const temporary = /^(provider_(rate_limit|http_(408|429|5\d\d))|source_(rate_limit|unavailable)|network_timeout)$/.test(code)
  return { status: attempts >= 3 && !temporary ? 'failed' : 'pending',
    attempts: temporary ? Math.max(0, attempts - 1) : attempts,
    delayMs: temporary ? 300000 : Math.min(1800000, 60000 * 2 ** Math.max(0, attempts - 1)), temporary }
}
