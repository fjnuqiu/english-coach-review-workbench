import AppKit
import Foundation
import Vision

if CommandLine.arguments.count < 2 {
    FileHandle.standardError.write(Data("usage: ocr_image.swift <image-path>\n".utf8))
    exit(2)
}

let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])
guard let image = NSImage(contentsOf: imageURL) else {
    FileHandle.standardError.write(Data("cannot read image\n".utf8))
    exit(1)
}

var imageRect = NSRect(origin: .zero, size: image.size)
guard let cgImage = image.cgImage(forProposedRect: &imageRect, context: nil, hints: nil) else {
    FileHandle.standardError.write(Data("cannot create cgImage\n".utf8))
    exit(1)
}

var recognizedLines: [String] = []
let request = VNRecognizeTextRequest { request, error in
    if let error = error {
        FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
        return
    }
    let observations = request.results as? [VNRecognizedTextObservation] ?? []
    recognizedLines = observations.compactMap { observation in
        observation.topCandidates(1).first?.string
    }
}

request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["en-US", "zh-Hans"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
    print(recognizedLines.joined(separator: "\n"))
} catch {
    FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
    exit(1)
}
