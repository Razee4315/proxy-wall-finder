/**
 * Browser-side parser for the sidecar's .npz depth contract:
 * numpy savez_compressed zip (deflate entries, zip64 size extras) holding
 * float16 depth[H, W] in metres + uint8 valid[H, W].
 */
export async function parseDepthNpz(bytes: Uint8Array): Promise<{
  depth: Float32Array
  valid?: Uint8Array
  width: number
  height: number
}> {
  const files = new Map<string, Uint8Array>()
  let o = 0
  while (o + 30 < bytes.length) {
    if (bytes[o] !== 0x50 || bytes[o + 1] !== 0x4b || bytes[o + 2] !== 3 || bytes[o + 3] !== 4) break
    const method = bytes[o + 8] | (bytes[o + 9] << 8)
    const nameLen = bytes[o + 26] | (bytes[o + 27] << 8)
    const extraLen = bytes[o + 28] | (bytes[o + 29] << 8)
    const name = new TextDecoder().decode(bytes.subarray(o + 30, o + 30 + nameLen))
    const extraStart = o + 30 + nameLen
    const dataStart = extraStart + extraLen
    let compSize =
      (bytes[o + 18] | (bytes[o + 19] << 8) | (bytes[o + 20] << 16) | (bytes[o + 21] << 24)) >>> 0
    if (compSize === 0xffffffff) {
      // zip64: real size lives in the extra field (numpy savez uses force_zip64)
      const extra = bytes.subarray(extraStart, dataStart)
      let e = 0
      let found = false
      while (e + 4 <= extra.length) {
        const id = extra[e] | (extra[e + 1] << 8)
        const size = extra[e + 2] | (extra[e + 3] << 8)
        if (id === 1 && size >= 16) {
          compSize = readU32(extra, e + 12)
          found = true
          break
        }
        e += 4 + size
      }
      if (!found) throw new Error(`NPZ entry ${name}: zip64 size missing`)
    }
    const raw = bytes.subarray(dataStart, dataStart + compSize)
    files.set(name.replace(/^\.\//, ''), method === 0 ? raw : await inflateRaw(raw))
    o = dataStart + compSize
  }
  const depthKey = [...files.keys()].find((k) => /depth.*\.npy$/i.test(k))
  if (!depthKey) throw new Error('NPZ missing depth.npy')
  const parsed = parseNpy(files.get(depthKey)!)
  const height = parsed.shape[0]
  const width = parsed.shape[1]
  const depth = Float32Array.from(parsed.values)
  let valid: Uint8Array | undefined
  const validKey = [...files.keys()].find((k) => /valid.*\.npy$/i.test(k))
  if (validKey) {
    valid = Uint8Array.from(parseNpy(files.get(validKey)!).values.map((x) => (x > 0 ? 1 : 0)))
  }
  return { depth, valid, width, height }
}

function readU32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser lacks DecompressionStream — use a current Chrome/Edge/Safari')
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function parseNpy(data: Uint8Array): { values: number[]; shape: number[] } {
  if (data[0] !== 0x93) throw new Error('Not NPY')
  const major = data[6]
  const headerLen =
    major === 1
      ? data[8] | (data[9] << 8)
      : data[8] | (data[9] << 8) | (data[10] << 16) | (data[11] << 24)
  const headerStart = major === 1 ? 10 : 12
  const header = new TextDecoder().decode(data.subarray(headerStart, headerStart + headerLen))
  const shapeMatch = /'shape':\s*\(([^)]*)\)/.exec(header)
  const descrMatch = /'descr':\s*'([^']+)'/.exec(header)
  if (!shapeMatch || !descrMatch) throw new Error('Bad NPY header')
  const shape = shapeMatch[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
  const descr = descrMatch[1]
  const body = data.subarray(headerStart + headerLen)
  const count = shape.reduce((a, b) => a * b, 1)
  const values = new Array<number>(count)
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
  if (descr.includes('f2')) {
    for (let i = 0; i < count; i++) values[i] = f16(view.getUint16(i * 2, true))
  } else if (descr.includes('f4')) {
    for (let i = 0; i < count; i++) values[i] = view.getFloat32(i * 4, true)
  } else if (descr.includes('u1')) {
    for (let i = 0; i < count; i++) values[i] = body[i]
  } else throw new Error(`Unsupported dtype ${descr}`)
  return { values, shape }
}

function f16(u: number): number {
  const s = (u & 0x8000) >> 15
  const e = (u & 0x7c00) >> 10
  const f = u & 0x03ff
  if (e === 0) return (s ? -1 : 1) * 2 ** -14 * (f / 1024)
  if (e === 31) return f ? Number.NaN : s ? -Infinity : Infinity
  return (s ? -1 : 1) * 2 ** (e - 15) * (1 + f / 1024)
}
