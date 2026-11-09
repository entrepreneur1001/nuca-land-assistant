// OCR images with Apple Vision, one entry per whitespace-separated token with its own box.
// usage: ocr_tokens <out.json> <img>...   Output per image: [{"text","conf","x","y","w","h","alts":[..]}] in image pixels (origin top-left).
import Foundation
import Vision
import CoreGraphics
import ImageIO
let a = CommandLine.arguments
guard a.count >= 3 else { fputs("usage: ocr_tokens <out.json> <img>...\n", stderr); exit(1) }
var out: [[[String: Any]]] = []
for path in a[2...] {
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil), let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) else { out.append([]); continue }
    let W = Double(cg.width), H = Double(cg.height)
    var obs: [[String: Any]] = []
    let req = VNRecognizeTextRequest { res, _ in
        for o in res.results as? [VNRecognizedTextObservation] ?? [] {
            let cands = o.topCandidates(3)
            guard let c = cands.first else { continue }
            let s = c.string
            let alts = cands.dropFirst().map { $0.string }
            var idx = s.startIndex
            while idx < s.endIndex {
                while idx < s.endIndex && s[idx] == " " { idx = s.index(after: idx) }
                if idx >= s.endIndex { break }
                var j = idx
                while j < s.endIndex && s[j] != " " { j = s.index(after: j) }
                if let bo = try? c.boundingBox(for: idx..<j) {
                    let b = bo.boundingBox
                    obs.append(["text": String(s[idx..<j]), "conf": Double(c.confidence), "x": b.minX * W, "y": (1 - b.maxY) * H, "w": b.width * W, "h": b.height * H, "line": s, "alts": alts])
                }
                idx = j
            }
        }
    }
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = false
    req.recognitionLanguages = ["en-US"]
    req.minimumTextHeight = 0.005
    if #available(macOS 13.0, *) { req.revision = VNRecognizeTextRequestRevision3 }
    try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
    out.append(obs)
}
try JSONSerialization.data(withJSONObject: out).write(to: URL(fileURLWithPath: a[1]))
