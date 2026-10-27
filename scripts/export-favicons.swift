// scripts/export-favicons.swift — favicon.ico et icône monochrome (rendu SVG natif de macOS). Usage, depuis la racine :
//   swift scripts/export-favicons.swift
//   assets/icons/favicon.ico        16, 32 et 48 px, depuis assets/brand/chays-favicon.svg (roi plein cadre, fond noyer)
//   assets/icons/icon-mono-512.png  silhouette blanche sur fond transparent, depuis assets/brand/chays-icone.svg
//                                   (même place que l'icône masquable : le roi tient dans la zone sûre) ;
//                                   Android 13+ la teinte selon le fond d'écran (manifest, "purpose": "monochrome").
// Les autres PNG (192, 512, masquable, apple-touch) viennent de scripts/export-icons.swift.
import AppKit

func render(_ svg: String, _ size: Int) -> Data {
    guard let image = NSImage(data: svg.data(using: .utf8)!) else { fatalError("SVG illisible") }
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                               bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: size, height: size)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current!.imageInterpolation = .high
    image.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

// ─── favicon.ico : conteneur ICO d'images PNG (accepté par tous les navigateurs actuels) ───
let favSvg = try! String(contentsOfFile: "assets/brand/chays-favicon.svg", encoding: .utf8)
let sizes = [16, 32, 48]
let pngs = sizes.map { render(favSvg, $0) }
var ico = Data()
func le16(_ v: Int) { ico.append(contentsOf: [UInt8(v & 0xff), UInt8((v >> 8) & 0xff)]) }
func le32(_ v: Int) { le16(v & 0xffff); le16((v >> 16) & 0xffff) }
le16(0); le16(1); le16(sizes.count)                        // en-tête : réservé, type icône, nombre d'images
var offset = 6 + 16 * sizes.count
for (i, s) in sizes.enumerated() {                         // une entrée de 16 octets par image
    ico.append(contentsOf: [UInt8(s), UInt8(s), 0, 0])     // largeur, hauteur, couleurs, réservé
    le16(1); le16(32); le32(pngs[i].count); le32(offset)   // plans, bits par pixel, taille, position
    offset += pngs[i].count
}
pngs.forEach { ico.append($0) }
try! ico.write(to: URL(fileURLWithPath: "assets/icons/favicon.ico"))
print("assets/icons/favicon.ico  \(sizes.map(String.init).joined(separator: ", ")) px")

// ─── Monochrome : sans fond, toutes les couleurs en blanc (seule la transparence compte) ───
var mono = try! String(contentsOfFile: "assets/brand/chays-icone.svg", encoding: .utf8)
mono = mono.replacingOccurrences(of: #"<rect id="fond"[^>]*/>"#, with: "", options: .regularExpression)
mono = mono.replacingOccurrences(of: #"var\(--[a-z-]+, #[0-9a-fA-F]{3,8}\)"#, with: "#ffffff", options: .regularExpression)
try! render(mono, 512).write(to: URL(fileURLWithPath: "assets/icons/icon-mono-512.png"))
print("assets/icons/icon-mono-512.png  512×512")
