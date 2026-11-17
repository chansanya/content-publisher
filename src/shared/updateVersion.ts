export function isNewerStableVersion(current: string, latest: string): boolean {
  const parse = (version: string): number[] => {
    const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version)
    if (!match) throw new Error('版本号格式无效')
    return match.slice(1).map(Number)
  }
  const a = parse(current)
  const b = parse(latest)
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return b[i] > a[i]
  }
  return false
}
