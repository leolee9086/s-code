/**
 * media 工具测试（MIME 类型检测、魔法字节嗅探）
 */
import { describe, expect, test } from "bun:test"
import { isMedia, isImageAttachment, sniffAttachmentMime, isPdfAttachment } from "../../src/util/media"

describe("isMedia", () => {
  test("detects image mimes", () => {
    expect(isMedia("image/png")).toBe(true)
    expect(isMedia("image/jpeg")).toBe(true)
    expect(isMedia("image/gif")).toBe(true)
  })

  test("detects PDF", () => {
    expect(isMedia("application/pdf")).toBe(true)
  })

  test("returns false for non-media", () => {
    expect(isMedia("text/plain")).toBe(false)
  })
})

describe("isPdfAttachment", () => {
  test("detects PDF", () => {
    expect(isPdfAttachment("application/pdf")).toBe(true)
    expect(isPdfAttachment("image/png")).toBe(false)
  })
})

describe("isImageAttachment", () => {
  test("detects common image formats", () => {
    expect(isImageAttachment("image/png")).toBe(true)
    expect(isImageAttachment("image/jpeg")).toBe(true)
    expect(isImageAttachment("image/gif")).toBe(true)
  })

  test("excludes SVG", () => {
    expect(isImageAttachment("image/svg+xml")).toBe(false)
  })

  test("excludes fastbidsheet", () => {
    expect(isImageAttachment("image/vnd.fastbidsheet")).toBe(false)
  })
})

describe("sniffAttachmentMime", () => {
  function uint8(...bytes: number[]) {
    return new Uint8Array(bytes)
  }

  test("detects PNG magic bytes", () => {
    expect(sniffAttachmentMime(uint8(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "application/octet-stream"))
      .toBe("image/png")
  })

  test("detects JPEG magic bytes", () => {
    expect(sniffAttachmentMime(uint8(0xff, 0xd8, 0xff, 0xe0), "application/octet-stream"))
      .toBe("image/jpeg")
  })

  test("detects GIF magic bytes", () => {
    expect(sniffAttachmentMime(uint8(0x47, 0x49, 0x46, 0x38, 0x39, 0x61), "application/octet-stream"))
      .toBe("image/gif")
  })

  test("detects BMP magic bytes", () => {
    expect(sniffAttachmentMime(uint8(0x42, 0x4d), "application/octet-stream"))
      .toBe("image/bmp")
  })

  test("detects PDF magic bytes", () => {
    expect(sniffAttachmentMime(uint8(0x25, 0x50, 0x44, 0x46, 0x2d), "application/octet-stream"))
      .toBe("application/pdf")
  })

  test("detects WebP magic bytes", () => {
    const webpHeader = uint8(
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00, // size (placeholder)
      0x57, 0x45, 0x42, 0x50, // WEBP
    )
    expect(sniffAttachmentMime(webpHeader, "application/octet-stream"))
      .toBe("image/webp")
  })

  test("falls back to default for unknown bytes", () => {
    expect(sniffAttachmentMime(uint8(0x00, 0x01, 0x02), "text/plain"))
      .toBe("text/plain")
  })

  test("handles empty buffer", () => {
    expect(sniffAttachmentMime(uint8(), "text/plain")).toBe("text/plain")
  })
})
