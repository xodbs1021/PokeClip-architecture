const ROUTING_CORE_URL = 'https://viewer.diagrams.net/js/libavoid-js/libavoid-routing.js'
const originalFetch = globalThis.fetch

globalThis.fetch = async function fetchWithVendoredRoutingCore(input, init) {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url
  if (url === ROUTING_CORE_URL) throw new Error('POKECLIP_VENDORED_CORE_ONLY')
  return originalFetch(input, init)
}
