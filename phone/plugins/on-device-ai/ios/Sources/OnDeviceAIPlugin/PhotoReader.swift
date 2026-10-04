import Foundation
import UIKit
import Vision
import CoreImage

/// Reads a photo on the phone with Apple's Vision framework: printed text (receipts,
/// labels), barcodes, what the picture shows, and its main colour.
enum PhotoReader {
    struct BadImage: LocalizedError {
        var errorDescription: String? { "Couldn't open that photo." }
    }

    static func read(_ data: Data, onlyBarcodes: Bool) throws -> [String: Any] {
        guard let image = UIImage(data: data), let cgImage = image.cgImage else { throw BadImage() }
        let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation(image.imageOrientation), options: [:])

        let barcodes = VNDetectBarcodesRequest()
        var requests: [VNRequest] = [barcodes]
        let text = VNRecognizeTextRequest()
        text.recognitionLevel = .accurate
        text.usesLanguageCorrection = true
        text.recognitionLanguages = ["en-GB", "en-US"]
        let classify = VNClassifyImageRequest()
        if !onlyBarcodes { requests += [text, classify] }
        try handler.perform(requests)

        var codes: [String] = []
        for b in barcodes.results ?? [] {
            if let value = b.payloadStringValue, !codes.contains(value) { codes.append(value) }
        }
        if onlyBarcodes { return ["barcodes": codes] }

        let lines = (text.results ?? []).compactMap { $0.topCandidates(1).first?.string }
        let labels = (classify.results ?? [])
            .filter { $0.confidence > 0.1 }
            .prefix(10)
            .map { ["name": $0.identifier.replacingOccurrences(of: "_", with: " "), "confidence": Double($0.confidence)] as [String: Any] }

        return [
            "text": lines.joined(separator: "\n"),
            "barcodes": codes,
            "labels": Array(labels),
            "colour": mainColour(cgImage) ?? ""
        ]
    }

    private static func orientation(_ o: UIImage.Orientation) -> CGImagePropertyOrientation {
        switch o {
        case .up: return .up
        case .down: return .down
        case .left: return .left
        case .right: return .right
        case .upMirrored: return .upMirrored
        case .downMirrored: return .downMirrored
        case .leftMirrored: return .leftMirrored
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
    }

    // Average colour of the middle of the photo, named with a plain word.
    private static func mainColour(_ cgImage: CGImage) -> String? {
        let ci = CIImage(cgImage: cgImage)
        let e = ci.extent
        let middle = CGRect(x: e.minX + e.width * 0.3, y: e.minY + e.height * 0.3, width: e.width * 0.4, height: e.height * 0.4)
        guard let filter = CIFilter(name: "CIAreaAverage", parameters: [kCIInputImageKey: ci, kCIInputExtentKey: CIVector(cgRect: middle)]),
              let output = filter.outputImage else { return nil }
        var px = [UInt8](repeating: 0, count: 4)
        CIContext(options: [.workingColorSpace: NSNull()])
            .render(output, toBitmap: &px, rowBytes: 4, bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBA8, colorSpace: nil)
        return name(r: Double(px[0]), g: Double(px[1]), b: Double(px[2]))
    }

    private static let palette: [(String, Double, Double, Double)] = [
        ("black", 20, 20, 20), ("white", 240, 240, 240), ("grey", 128, 128, 128), ("navy", 30, 40, 90),
        ("blue", 50, 100, 200), ("light blue", 150, 190, 230), ("denim", 70, 95, 130), ("red", 200, 30, 40),
        ("pink", 235, 140, 180), ("purple", 120, 60, 150), ("green", 50, 140, 70), ("khaki", 150, 140, 90),
        ("yellow", 240, 210, 50), ("orange", 240, 130, 40), ("brown", 110, 70, 40), ("beige", 220, 200, 170)
    ]

    private static func name(r: Double, g: Double, b: Double) -> String {
        palette.min { a, c in
            let da = (a.1 - r) * (a.1 - r) + (a.2 - g) * (a.2 - g) + (a.3 - b) * (a.3 - b)
            let dc = (c.1 - r) * (c.1 - r) + (c.2 - g) * (c.2 - g) + (c.3 - b) * (c.3 - b)
            return da < dc
        }?.0 ?? ""
    }
}
