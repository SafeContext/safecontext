// Text from an image or a PDF, on this device (#40). The agent runs it before Claude reads one,
// so the text can be checked like any other.
//
//   sc-extract <path>   →   stdout: {"text": "...", "pages": 3, "ocrPages": 1}
//
// Images: Vision's text recognition (accurate mode). PDFs: each page's text layer (PDFKit); a page
// with little or no text (a scan) is rendered and read with Vision, up to MAX_OCR_PAGES pages.
// Exit code 2: the file can't be opened or read as an image or PDF. Never prints the text anywhere
// else, never writes a file.
import AppKit
import Foundation
import PDFKit
import Vision

let MAX_OCR_PAGES = 30
let MIN_PAGE_CHARS = 20

func fail(_ message: String) -> Never {
	FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
	exit(2)
}

func recognize(_ image: CGImage) -> String {
	let request = VNRecognizeTextRequest()
	request.recognitionLevel = .accurate
	request.usesLanguageCorrection = false
	let handler = VNImageRequestHandler(cgImage: image, options: [:])
	do { try handler.perform([request]) } catch { return "" }
	return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

func render(_ page: PDFPage) -> CGImage? {
	let bounds = page.bounds(for: .mediaBox)
	let scale: CGFloat = 2
	let width = Int(bounds.width * scale), height = Int(bounds.height * scale)
	guard width > 0, height > 0,
		let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
			space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
	else { return nil }
	ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
	ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
	ctx.scaleBy(x: scale, y: scale)
	page.draw(with: .mediaBox, to: ctx)
	return ctx.makeImage()
}

let args = CommandLine.arguments
guard args.count == 2 else { fail("usage: sc-extract <path>") }
let url = URL(fileURLWithPath: args[1])

var text = ""
var pages = 1
var ocrPages = 0
if url.pathExtension.lowercased() == "pdf" {
	guard let doc = PDFDocument(url: url) else { fail("not a readable PDF") }
	if doc.isLocked && !doc.unlock(withPassword: "") { fail("the PDF is password-protected") }
	pages = doc.pageCount
	var parts: [String] = []
	for i in 0..<doc.pageCount {
		guard let page = doc.page(at: i) else { continue }
		var pageText = page.string ?? ""
		if pageText.trimmingCharacters(in: .whitespacesAndNewlines).count < MIN_PAGE_CHARS, ocrPages < MAX_OCR_PAGES,
			let image = render(page) {
			ocrPages += 1
			pageText += "\n" + recognize(image)
		}
		parts.append(pageText)
	}
	text = parts.joined(separator: "\n\n")
} else {
	guard let image = NSImage(contentsOf: url),
		let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
	else { fail("not a readable image") }
	ocrPages = 1
	text = recognize(cg)
}

let out: [String: Any] = ["text": text, "pages": pages, "ocrPages": ocrPages]
let data = try! JSONSerialization.data(withJSONObject: out)
FileHandle.standardOutput.write(data)
