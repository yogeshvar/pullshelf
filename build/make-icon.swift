// Renders the Pullshelf icon (same geometry as build/icon.svg) into build/icon.iconset/*.png.
// Run: swiftc -O build/make-icon.swift -o /tmp/make-icon && /tmp/make-icon build/icon.iconset && iconutil -c icns build/icon.iconset -o build/icon.icns
import AppKit

func color(_ hex: UInt32) -> NSColor {
  NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: 1)
}

func render(pixels: Int) -> Data {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8,
    samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  rep.size = NSSize(width: pixels, height: pixels)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let s = CGFloat(pixels) / 1024
  let t = NSAffineTransform()
  t.scale(by: s)
  t.concat()
  color(0xf7f4ee).setFill()
  NSBezierPath(roundedRect: NSRect(x: 100, y: 100, width: 824, height: 824), xRadius: 185, yRadius: 185).fill()
  // SVG y runs down, AppKit y runs up: flip y as 1024 - y - height.
  color(0x1e1b17).setFill()
  NSBezierPath(roundedRect: NSRect(x: 302, y: 1024 - 390 - 84, width: 420, height: 84), xRadius: 42, yRadius: 42).fill()
  color(0xc8442f).setFill()
  NSBezierPath(ovalIn: NSRect(x: 512 - 62, y: 1024 - 328 - 62, width: 124, height: 124)).fill()
  NSGraphicsContext.restoreGraphicsState()
  return rep.representation(using: .png, properties: [:])!
}

let dir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon.iconset"
try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
for base in [16, 32, 128, 256, 512] {
  try render(pixels: base).write(to: URL(fileURLWithPath: "\(dir)/icon_\(base)x\(base).png"))
  try render(pixels: base * 2).write(to: URL(fileURLWithPath: "\(dir)/icon_\(base)x\(base)@2x.png"))
}
