import { BlockList, isIP } from 'node:net'

// Cloudflare 公布的出口 IP 段（https://www.cloudflare.com/ips-v4、/ips-v6，2026-11-12 讀取）。
// www 改成經過 Cloudflare 代理（橘雲）之後，Railway edge 看到的連線來源會是這些位址，訪客 IP
// 改由 Cloudflare 放在 CF-Connecting-IP。只有「上一跳確實是 Cloudflare」時才採信這個 header：
// 正式站的 Railway 網域與 edge 仍然可以直接連，繞過 Cloudflare 的人自己帶 CF-Connecting-IP
// 就會被忽略。Cloudflare 很少改這份清單；改了沒同步只會讓新段的訪客退回共用 Cloudflare 節點 IP
// 的限流桶（較嚴，不會放寬），見 deploy/README.md「Cloudflare 代理」。
export const CLOUDFLARE_IPV4_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22'
] as const

export const CLOUDFLARE_IPV6_RANGES = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32'
] as const

const cloudflare = new BlockList()
for (const range of CLOUDFLARE_IPV4_RANGES) {
  const [network = '', prefix = ''] = range.split('/')
  cloudflare.addSubnet(network, Number(prefix), 'ipv4')
}
for (const range of CLOUDFLARE_IPV6_RANGES) {
  const [network = '', prefix = ''] = range.split('/')
  cloudflare.addSubnet(network, Number(prefix), 'ipv6')
}

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i

/** 這個位址是不是 Cloudflare 的節點（IPv4-mapped IPv6 當 IPv4 看）。 */
export function isCloudflareIp(ip: string): boolean {
  const mapped = IPV4_MAPPED.exec(ip)
  if (mapped?.[1]) return cloudflare.check(mapped[1], 'ipv4')
  const family = isIP(ip)
  if (family === 4) return cloudflare.check(ip, 'ipv4')
  if (family === 6) return cloudflare.check(ip, 'ipv6')
  return false
}
