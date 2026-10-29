// Person matte generator: Apple Vision person segmentation -> grayscale H.264 (person = white).
// The public Tesseract CLI ships no segmentation model, so its personMatte effect renders white.
// Usage: swift personmatte.swift <in.mp4> <out.mp4>
import AVFoundation
import CoreImage
import Vision

let args = CommandLine.arguments
guard args.count == 3 else { print("usage: personmatte <in> <out>"); exit(2) }
let input = URL(fileURLWithPath: args[1]), output = URL(fileURLWithPath: args[2])
try? FileManager.default.removeItem(at: output)

let asset = AVURLAsset(url: input)
let track = asset.tracks(withMediaType: .video)[0]
let size = track.naturalSize.applying(track.preferredTransform)
let w = Int(abs(size.width)), h = Int(abs(size.height))

let reader = try AVAssetReader(asset: asset)
let rout = AVAssetReaderTrackOutput(track: track, outputSettings: [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
reader.add(rout)

let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
let win = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: w, AVVideoHeightKey: h,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 12_000_000]])
win.transform = track.preferredTransform
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: win, sourcePixelBufferAttributes: [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
  kCVPixelBufferWidthKey as String: Int(track.naturalSize.width),
  kCVPixelBufferHeightKey as String: Int(track.naturalSize.height)])
writer.add(win)
reader.startReading(); writer.startWriting(); writer.startSession(atSourceTime: .zero)

let ctx = CIContext()
let req = VNGeneratePersonSegmentationRequest()
req.qualityLevel = .accurate
req.outputPixelFormat = kCVPixelFormatType_OneComponent8
var n = 0
while let sample = rout.copyNextSampleBuffer() {
  guard let pb = CMSampleBufferGetImageBuffer(sample) else { continue }
  let t = CMSampleBufferGetPresentationTimeStamp(sample)
  try VNImageRequestHandler(cvPixelBuffer: pb).perform([req])
  let mask = CIImage(cvPixelBuffer: req.results![0].pixelBuffer)
  let fw = CGFloat(CVPixelBufferGetWidth(pb)), fh = CGFloat(CVPixelBufferGetHeight(pb))
  let scaled = mask.transformed(by: CGAffineTransform(scaleX: fw / mask.extent.width, y: fh / mask.extent.height))
  var out: CVPixelBuffer?
  CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &out)
  ctx.render(scaled, to: out!)
  while !win.isReadyForMoreMediaData { usleep(2000) }
  adaptor.append(out!, withPresentationTime: t)
  n += 1
}
win.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
print("\(args[1]) -> \(n) frames \(w)x\(h) status=\(writer.status.rawValue)")
