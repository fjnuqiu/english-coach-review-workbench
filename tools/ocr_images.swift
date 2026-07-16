#!/usr/bin/env swift

import AppKit
import Foundation
import Vision

guard CommandLine.arguments.count >= 2 else {
    FileHandle.standardError.write(Data("usage: ocr_images.swift <image-directory>\n".utf8))
    exit(2)
}

let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let allowed = Set(["jpg", "jpeg", "png", "heic", "webp", "tiff", "bmp"])
let files = (try FileManager.default.contentsOfDirectory(
    at: directory,
    includingPropertiesForKeys: nil,
    options: [.skipsHiddenFiles]
))
    .filter { allowed.contains($0.pathExtension.lowercased()) }
    .sorted { $0.lastPathComponent < $1.lastPathComponent }

for imageURL in files {
    autoreleasepool {
        guard let image = NSImage(contentsOf: imageURL) else { return }
        var imageRect = NSRect(origin: .zero, size: image.size)
        guard let cgImage = image.cgImage(forProposedRect: &imageRect, context: nil, hints: nil) else { return }

        var recognizedLines: [String] = []
        let request = VNRecognizeTextRequest { request, _ in
            let observations = request.results as? [VNRecognizedTextObservation] ?? []
            recognizedLines = observations.compactMap { $0.topCandidates(1).first?.string }
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = ["en-US", "zh-Hans"]

        do {
            try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
            let payload: [String: Any] = [
                "file": imageURL.lastPathComponent,
                "text": recognizedLines.joined(separator: "\n"),
            ]
            let data = try JSONSerialization.data(withJSONObject: payload, options: [])
            if let line = String(data: data, encoding: .utf8) {
                print(line)
            }
        } catch {
            return
        }
    }
}
