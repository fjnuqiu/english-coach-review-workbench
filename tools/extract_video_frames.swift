#!/usr/bin/env swift

import AppKit
import AVFoundation
import Foundation

guard CommandLine.arguments.count >= 3 else {
    FileHandle.standardError.write(Data("usage: extract_video_frames.swift <video> <output-dir> [count]\n".utf8))
    exit(2)
}

let videoURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
let requestedCount = CommandLine.arguments.count > 3 ? Int(CommandLine.arguments[3]) ?? 12 : 12
let frameCount = max(3, min(requestedCount, 240))

try FileManager.default.createDirectory(at: outputURL, withIntermediateDirectories: true)

let asset = AVURLAsset(url: videoURL)
let durationSeconds = CMTimeGetSeconds(asset.duration)
guard durationSeconds.isFinite, durationSeconds > 0 else {
    FileHandle.standardError.write(Data("video duration is unavailable\n".utf8))
    exit(3)
}

let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.maximumSize = CGSize(width: 1600, height: 1600)
generator.requestedTimeToleranceBefore = CMTime(seconds: 0.35, preferredTimescale: 600)
generator.requestedTimeToleranceAfter = CMTime(seconds: 0.35, preferredTimescale: 600)

for index in 0..<frameCount {
    let fraction = (Double(index) + 0.5) / Double(frameCount)
    let seconds = durationSeconds * fraction
    let time = CMTime(seconds: seconds, preferredTimescale: 600)
    do {
        let image = try generator.copyCGImage(at: time, actualTime: nil)
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.82]) else {
            continue
        }
        let path = outputURL.appendingPathComponent(String(format: "frame-%03d.jpg", index + 1))
        try data.write(to: path, options: .atomic)
        print(path.path)
    } catch {
        continue
    }
}
