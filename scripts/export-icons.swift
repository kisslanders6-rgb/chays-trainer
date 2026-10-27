// scripts/export-icons.swift — régénère les icônes PNG à partir d'assets/brand/chays-icone.svg
// (rendu SVG natif de macOS). Usage, depuis la racine du projet :
//   swift scripts/export-icons.swift
// Favicon (.ico) et icône monochrome : scripts/export-favicons.swift ; favicon vectoriel : assets/icons/icon.svg.
// Les variables CSS du SVG (--ct-encre…) sont remplacées par leurs valeurs de repli avant le rendu.
import AppKit

let svgPath = "assets/brand/chays-icone.svg"
let targets: [(String, Int)] = [
    ("icon-512", 512), ("icon-maskable-512", 512), ("icon-192", 192),
    ("apple-touch-icon", 180)
]

var svg = try! String(contentsOfFile: svgPath, encoding: .utf8)
let vars = try! NSRegularExpression(pattern: #"var\(--[a-z-]+, (#[0-9a-fA-F]{3,8})\)"#)
svg = vars.stringByReplacingMatches(in: svg, range: NSRange(svg.startIndex..., in: svg), withTemplate: "$1")
guard let image = NSImage(data: svg.data(using: .utf8)!) else { fatalError("SVG illisible : \(svgPath)") }

for (name, size) in targets {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                               bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: size, height: size)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current!.imageInterpolation = .high
    image.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
    NSGraphicsContext.restoreGraphicsState()
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "assets/icons/\(name).png"))
    print("assets/icons/\(name).png  \(size)×\(size)")
}
