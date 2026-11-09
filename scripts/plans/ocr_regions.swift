// OCR rectangles of one image with Apple Vision. usage: ocr_regions <image> <regions.json> <out.json>
// regions.json: [[x,y,w,h], ...] in image pixels (origin top-left). Each crop is upscaled so digits are ~60 px tall.
// Output: [{"text": "...", "conf": 0.9}, ...] aligned with the input (text "" when nothing read).
import Foundation
import Vision
import CoreGraphics
import ImageIO

let a = CommandLine.arguments
guard a.count >= 4 else { fputs("usage: ocr_regions <image> <regions.json> <out.json>\n", stderr); exit(1) }
guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: a[1]) as CFURL, nil), let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) else { fputs("cannot load\n", stderr); exit(1) }
let regions = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: a[2]))) as! [[Double]]
var out: [[String: Any]] = []
let cs = CGColorSpaceCreateDeviceRGB()
for r in regions {
    let x = max(0, Int(r[0])), y = max(0, Int(r[1]))
    let w = min(cg.width - x, Int(r[2])), h = min(cg.height - y, Int(r[3]))
    guard w > 4, h > 4, let crop = cg.cropping(to: CGRect(x: x, y: y, width: w, height: h)) else { out.append(["text": "", "conf": 0]); continue }
    let scale = max(1.0, min(6.0, 240.0 / Double(min(w, h))))
    let W = Int(Double(w) * scale), H = Int(Double(h) * scale)
    let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    ctx.interpolationQuality = .high
    ctx.draw(crop, in: CGRect(x: 0, y: 0, width: W, height: H))
    guard let up = ctx.makeImage() else { out.append(["text": "", "conf": 0]); continue }
    var best = ["text": "", "conf": 0.0] as [String: Any]
    var texts: [String] = []
    let req = VNRecognizeTextRequest { res, _ in
        for o in res.results as? [VNRecognizedTextObservation] ?? [] {
            guard let c = o.topCandidates(1).first else { continue }
            texts.append(c.string)
            if Double(c.confidence) > (best["conf"] as! Double) { best = ["text": c.string, "conf": Double(c.confidence)] }
        }
    }
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = false
    req.recognitionLanguages = ["en-US"]
    if #available(macOS 13.0, *) { req.revision = VNRecognizeTextRequestRevision3 }
    try? VNImageRequestHandler(cgImage: up, options: [:]).perform([req])
    best["all"] = texts
    out.append(best)
}
try JSONSerialization.data(withJSONObject: out).write(to: URL(fileURLWithPath: a[3]))
