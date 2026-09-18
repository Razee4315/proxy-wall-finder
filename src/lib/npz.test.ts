import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { parseDepthNpz } from './npz'

/** Build one local zip entry exactly like numpy's savez(force_zip64=True):
 * deflate, 0xFFFFFFFF sizes in the fixed header, real sizes in a zip64 extra. */
function zip64DeflateEntry(name: string, data: Uint8Array): Uint8Array {
  const comp = deflateRawSync(data)
  const nameBytes = new TextEncoder().encode(name)
  const extra = new Uint8Array(20)
  extra[0] = 0x01
  extra[1] = 0x00
  extra[2] = 0x10
  extra[3] = 0x00
  const dv = new DataView(extra.buffer)
  dv.setBigUint64(4, BigInt(data.length), true)
  dv.setBigUint64(12, BigInt(comp.length), true)

  const header = new Uint8Array(30 + nameBytes.length + extra.length)
  const hv = new DataView(header.buffer)
  header.set([0x50, 0x4b, 0x03, 0x04], 0)
  hv.setUint16(4, 45, true)
  hv.setUint16(6, 0, true)
  hv.setUint16(8, 8, true)
  hv.setUint32(18, 0xffffffff, true)
  hv.setUint32(22, 0xffffffff, true)
  hv.setUint16(26, nameBytes.length, true)
  hv.setUint16(28, extra.length, true)
  header.set(nameBytes, 30)
  header.set(extra, 30 + nameBytes.length)

  const out = new Uint8Array(header.length + comp.length)
  out.set(header, 0)
  out.set(comp, header.length)
  return out
}

function npyBytes(values: number[], shape: [number, number], descr: '<f2' | '|u1'): Uint8Array {
  const header =
    descr === '<f2'
      ? `{'descr': '<f2', 'fortran_order': False, 'shape': (${shape[0]}, ${shape[1]}), }`
      : `{'descr': '|u1', 'fortran_order': False, 'shape': (${shape[0]}, ${shape[1]}), }`
  const padded = header + ' '.repeat((16 - ((10 + header.length) % 16)) % 16) + '\n'
  const body = new Uint8Array(values.length * 2)
  if (descr === '<f2') {
    const dv = new DataView(new ArrayBuffer(2))
    values.forEach((v, i) => {
      dv.setUint16(0, f32ToF16Bits(v), true)
      body[i * 2] = dv.getUint8(0)
      body[i * 2 + 1] = dv.getUint8(1)
    })
    const bytes = new Uint8Array(10 + padded.length + body.length)
    bytes.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 0x01, 0x00], 0)
    bytes[8] = padded.length & 0xff
    bytes[9] = (padded.length >> 8) & 0xff
    bytes.set(new TextEncoder().encode(padded), 10)
    bytes.set(body, 10 + padded.length)
    return bytes
  }
  const bytes = new Uint8Array(10 + padded.length + values.length)
  bytes.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 0x01, 0x00], 0)
  bytes[8] = padded.length & 0xff
  bytes[9] = (padded.length >> 8) & 0xff
  bytes.set(new TextEncoder().encode(padded), 10)
  bytes.set(Uint8Array.from(values), 10 + padded.length)
  return bytes
}

function f32ToF16Bits(f: number): number {
  const dv = new DataView(new ArrayBuffer(4))
  dv.setFloat32(0, f)
  const x = dv.getUint32(0)
  const s = (x >>> 16) & 0x8000
  const e = ((x >>> 23) & 0xff) - 112
  const m = x & 0x007fffff
  return s | ((e << 10) + (m >>> 13))
}

describe('parseDepthNpz (numpy savez_compressed contract)', () => {
  it('reads zip64 + deflate entries with float16 depth and uint8 valid', async () => {
    // 2x3 depth in metres, uint8 valid — row-major
    const depth = new Uint8Array(2 * 3 * 2)
    const dv = new DataView(depth.buffer)
    const meters = [1.5, 4.25, 100, 0, 2.0, 3.5]
    meters.forEach((m, i) => dv.setUint16(i * 2, f32ToF16Bits(m), true))
    const valid = Uint8Array.from([1, 1, 0, 0, 1, 1])

    const npz = new Uint8Array([
      ...zip64DeflateEntry('depth.npy', npyBytes(meters, [2, 3], '<f2')),
      ...zip64DeflateEntry('valid.npy', npyBytes([...valid], [2, 3], '|u1')),
    ])

    const r = await parseDepthNpz(npz)
    expect(r.width).toBe(3)
    expect(r.height).toBe(2)
    expect(r.depth[0]).toBeCloseTo(1.5, 1)
    expect(r.depth[1]).toBeCloseTo(4.25, 1)
    expect(r.depth[2]).toBe(100) // f16 exact
    expect(r.valid).toBeDefined()
    expect([...(r.valid ?? [])]).toEqual([1, 1, 0, 0, 1, 1])
  })
})
