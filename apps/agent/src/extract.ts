/**
 * Images and PDFs Claude reads (#40). Claude Code hands the hook only the file's bytes, so the
 * agent pulls the text out first, on this device, with the `sc-extract` helper
 * (`native/extract.swift`: Vision text recognition for images and scanned pages, the PDF's own
 * text layer otherwise), and checks that text before the Read runs.
 */
import { execFile } from 'node:child_process';
import { extname } from 'node:path';

/** File types Claude Code's Read turns into an image or a document for the model. */
export const MEDIA_EXTENSIONS = new Set([
	'png',
	'jpg',
	'jpeg',
	'gif',
	'webp',
	'heic',
	'heif',
	'tif',
	'tiff',
	'bmp',
	'pdf'
]);

export type MediaKind = 'image' | 'PDF';

/** `image` or `PDF` for a path Read would show Claude as one, else undefined. */
export function mediaKind(path: string): MediaKind | undefined {
	const ext = extname(path).slice(1).toLowerCase();
	if (!MEDIA_EXTENSIONS.has(ext)) return undefined;
	return ext === 'pdf' ? 'PDF' : 'image';
}

export interface Extractor {
	/**
	 * The file's text. Rejects if it can't be read, isn't an image or PDF, takes longer than
	 * `timeoutMs`, or some of its pages couldn't be read (so it can't be called checked).
	 */
	extract(path: string, timeoutMs: number): Promise<string>;
}

/** Runs the `sc-extract` helper at `bin`. */
export function createExtractor(bin: string): Extractor {
	return {
		extract: (path, timeoutMs) =>
			new Promise((resolve, reject) => {
				execFile(
					bin,
					[path],
					{ timeout: Math.max(1, Math.floor(timeoutMs)), maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' },
					(err, stdout) => {
						if (err) return reject(new Error('extract_failed'));
						try {
							const { text, skippedPages } = JSON.parse(stdout) as { text?: unknown; skippedPages?: unknown };
							if (typeof text !== 'string') throw new Error('bad output');
							if (typeof skippedPages === 'number' && skippedPages > 0) throw new Error('pages skipped');
							resolve(text);
						} catch {
							reject(new Error('extract_failed'));
						}
					}
				);
			})
	};
}
