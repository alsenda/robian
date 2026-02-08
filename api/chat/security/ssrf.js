import dns from 'node:dns/promises'
import net from 'node:net'

export function isPrivateIp(ip) {
  const version = net.isIP(ip)
  if (!version) return false

  if (version === 6) {
    const normalized = ip.toLowerCase()
    if (normalized === '::1') return true
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true // unique local
    if (normalized.startsWith('fe80:')) return true // link-local
    return false
  }

  const [a, b] = ip.split('.').map((n) => Number(n))
  if (a === 127) return true
  if (a === 10) return true
  if (a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

export async function assertPublicHostname(hostname) {
  const clean = hostname.replace(/\.$/, '')
  if (!clean) throw new Error('Invalid hostname')

  const ipVersion = net.isIP(clean)
  if (ipVersion) {
    if (isPrivateIp(clean)) throw new Error('Blocked private IP address')
    return
  }

  if (clean === 'localhost') throw new Error('Blocked hostname')

  const records = await dns.lookup(clean, { all: true })
  if (!records?.length) throw new Error('Could not resolve hostname')
  for (const record of records) {
    if (record?.address && isPrivateIp(record.address)) {
      throw new Error('Blocked private IP address')
    }
  }
}
