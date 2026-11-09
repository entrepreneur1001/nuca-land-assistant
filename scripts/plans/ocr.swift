// OCR an image with Apple Vision; prints JSON lines: {"text":..,"conf":..,"x":..,"y":..,"w":..,"h":..} in image pixels (origin top-left).
import Foundation
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count >= 2 else { fputs("usage: ocr <image> [out.json]\n", stderr); exit(1) }
guard let img = NSImage(contentsOfFile: args[1]), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { fputs("cannot load\n", stderr); exit(1) }
let W = CGFloat(cg.width), H = CGFloat(cg.height)
var out: [[String: Any]] = []
let req = VNRecognizeTextRequest { r, _ in
    for o in r.results as? [VNRecognizedTextObservation] ?? [] {
        guard let c = o.topCandidates(1).first else { continue }
        let b = o.boundingBox
        out.append(["text": c.string, "conf": c.confidence, "x": b.minX * W, "y": (1 - b.maxY) * H, "w": b.width * W, "h": b.height * H])
    }
}
req.recognitionLevel = .accurate
req.usesLanguageCorrection = false
req.recognitionLanguages = ["en-US"]
if #available(macOS 13.0, *) { req.revision = VNRecognizeTextRequestRevision3 }
try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
let data = try JSONSerialization.data(withJSONObject: out)
if args.count >= 3 { try data.write(to: URL(fileURLWithPath: args[2])) } else { print(String(data: data, encoding: .utf8)!) }
