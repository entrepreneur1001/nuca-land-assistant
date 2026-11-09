// OCR many small images with Apple Vision. usage: ocr_files <out.json> <img1> <img2> ...
// Each image is upscaled so its shorter side is ~240 px. Output per image: [{"text","conf","cx","cy"}] with the
// observation centre in the ORIGINAL image's pixels.
import Foundation
import Vision
import CoreGraphics
import ImageIO

let a = CommandLine.arguments
guard a.count >= 3 else { fputs("usage: ocr_files <out.json> <img>...\n", stderr); exit(1) }
let cs = CGColorSpaceCreateDeviceRGB()
var out: [[[String: Any]]] = []
for path in a[2...] {
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil), let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) else { out.append([]); continue }
    let w = cg.width, h = cg.height
    let scale = max(1.0, min(8.0, 240.0 / Double(min(w, h))))
    let W = Int(Double(w) * scale), H = Int(Double(h) * scale)
    let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    ctx.interpolationQuality = .high
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: W, height: H))
    guard let up = ctx.makeImage() else { out.append([]); continue }
    var obs: [[String: Any]] = []
    let req = VNRecognizeTextRequest { res, _ in
        for o in res.results as? [VNRecognizedTextObservation] ?? [] {
            for c in o.topCandidates(3) {
                let b = o.boundingBox
                obs.append(["text": c.string, "conf": Double(c.confidence), "cx": b.midX * Double(w), "cy": (1 - b.midY) * Double(h), "h": b.height * Double(h)])
            }
        }
    }
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = false
    req.recognitionLanguages = ["en-US"]
    if #available(macOS 13.0, *) { req.revision = VNRecognizeTextRequestRevision3 }
    try? VNImageRequestHandler(cgImage: up, options: [:]).perform([req])
    out.append(obs)
}
try JSONSerialization.data(withJSONObject: out).write(to: URL(fileURLWithPath: a[1]))
