import Defuddle from 'defuddle/full';
import { setElementHTML } from './dom-utils';

/**
 * Remove plain-text alternatives when a rich HTML version exists as a sibling.
 * Some sites (e.g. joinquant.com) render two copies of the same content:
 * a plain-text div and an HTML div with proper <p> tags. Defuddle can end up
 * scoring the text copy higher, which loses paragraph breaks. Removing the
 * text copy forces Defuddle to use the structured HTML version.
 */
function removePlainTextAlternatives(doc: Document): void {
	// Specific pattern used by joinquant.com
	const textVersions = doc.querySelectorAll('.jq-c-markdown-render-text');
	for (const textEl of Array.from(textVersions)) {
		const parent = textEl.parentElement;
		if (parent && parent.querySelector(':scope > .jq-c-markdown-render-html')) {
			textEl.remove();
		}
	}

	// General heuristic: within the same parent, if one child is a bare text
	// container and a sibling contains proper paragraph markup, discard the
	// bare text container.
	const containers = doc.querySelectorAll('[class*="markdown"], [class*="content"], article, .post-body, .entry-content');
	for (const container of Array.from(containers)) {
		const children = Array.from(container.children);
		if (children.length < 2) continue;

		for (let i = 0; i < children.length; i++) {
			const child = children[i];
			if (child.querySelector('p, li, h1, h2, h3, h4, h5, h6, table, blockquote')) {
				// This child has structured markup — nothing to remove here
				continue;
			}
			// Check if any sibling has paragraph markup and similar length
			const textLen = (child.textContent || '').trim().length;
			if (textLen < 50) continue;

			for (let j = 0; j < children.length; j++) {
				if (i === j) continue;
				const sibling = children[j];
				if (!sibling.querySelector('p, li, h1, h2, h3, h4, h5, h6, table, blockquote')) {
					continue;
				}
				const siblingTextLen = (sibling.textContent || '').trim().length;
				// If lengths are within 30%, they likely represent the same content
				if (Math.abs(textLen - siblingTextLen) / Math.max(textLen, siblingTextLen) < 0.3) {
					child.remove();
					break;
				}
			}
		}
	}
}

/**
 * Split <p> elements that use consecutive <br> elements as paragraph separators.
 * Some sites put <br><br> inside a single <p> instead of closing and reopening
 * the paragraph. This breaks Markdown conversion because Turndown treats the
 * entire <p> as one paragraph.
 */
function splitParagraphsAtBr(doc: Document): void {
	const paragraphs = doc.querySelectorAll('p');

	for (const p of Array.from(paragraphs)) {
		const children = Array.from(p.childNodes);
		if (children.length < 3) continue;

		// Find sequences of 2+ <br> elements
		const splitIndices: number[] = [];
		let brStart = -1;
		let brCount = 0;

		for (let i = 0; i <= children.length; i++) {
			const node = children[i];
			const isBr = node && node.nodeType === Node.ELEMENT_NODE &&
				(node as Element).tagName.toLowerCase() === 'br';
			const isWhitespace = node && node.nodeType === Node.TEXT_NODE &&
				(node.textContent || '').trim() === '';

			if (isBr) {
				if (brCount === 0) {
					brStart = i;
				}
				brCount++;
			} else if (!isWhitespace) {
				if (brCount >= 2) {
					splitIndices.push(brStart);
				}
				brCount = 0;
			}
		}

		if (splitIndices.length === 0) {
			continue;
		}

		// Build segments between split points
		const segments: Node[][] = [];
		let segStart = 0;

		for (const splitStart of splitIndices) {
			const segment = children.slice(segStart, splitStart);
			if (segment.length > 0) {
				segments.push(segment);
			}
			segStart = splitStart;
			while (segStart < children.length) {
				const node = children[segStart];
				const isBr = node.nodeType === Node.ELEMENT_NODE &&
					(node as Element).tagName.toLowerCase() === 'br';
				const isWhitespace = node.nodeType === Node.TEXT_NODE &&
					(node.textContent || '').trim() === '';
				if (!isBr && !isWhitespace) {
					break;
				}
				segStart++;
			}
		}

		const finalSegment = children.slice(segStart);
		if (finalSegment.length > 0) {
			segments.push(finalSegment);
		}

		const nonEmptySegments = segments.filter(segment =>
			segment.some(n => {
				if (n.nodeType === Node.TEXT_NODE) {
					return (n.textContent || '').trim() !== '';
				}
				return n.nodeType === Node.ELEMENT_NODE;
			})
		);

		if (nonEmptySegments.length <= 1) {
			continue;
		}

		const fragment = doc.createDocumentFragment();
		for (let i = 0; i < nonEmptySegments.length; i++) {
			const segment = nonEmptySegments[i];
			const newP = doc.createElement('p');
			for (const node of segment) {
				newP.appendChild(node);
			}
			fragment.appendChild(newP);
		}
		p.replaceWith(fragment);
	}
}

/**
 * Pre-process the DOM to fix paragraph segmentation on sites that use
 * consecutive <br> elements instead of <p> tags to separate paragraphs.
 * Must run before Defuddle parses the document.
 */
export function preprocessParagraphs(doc: Document): void {
	// First: remove plain-text alternatives so Defuddle uses structured HTML
	removePlainTextAlternatives(doc);

	// Second: split <p> elements that use <br><br> as paragraph separators
	splitParagraphsAtBr(doc);

	// Third: handle block-level elements that use <br><br> instead of <p>
	const BLOCK_SELECTORS = 'div, section, article, td, li, blockquote, aside, header, footer, main, nav';
	const candidates = Array.from(doc.querySelectorAll(BLOCK_SELECTORS));

	for (const el of candidates) {
		// Skip preformatted content and hidden elements
		if (el.closest('pre, code, script, style, [hidden]')) {
			continue;
		}

		// Skip if this element already uses standard <p> paragraphs
		if (el.querySelector(':scope > p')) {
			continue;
		}

		const children = Array.from(el.childNodes);
		if (children.length < 3) {
			continue;
		}

		// Find sequences of 2+ <br> elements (ignoring whitespace text nodes between them)
		const splitIndices: number[] = [];
		let brStart = -1;
		let brCount = 0;

		for (let i = 0; i <= children.length; i++) {
			const node = children[i];
			const isBr = node && node.nodeType === Node.ELEMENT_NODE &&
				(node as Element).tagName.toLowerCase() === 'br';
			const isWhitespace = node && node.nodeType === Node.TEXT_NODE &&
				(node.textContent || '').trim() === '';

			if (isBr) {
				if (brCount === 0) {
					brStart = i;
				}
				brCount++;
			} else if (!isWhitespace) {
				if (brCount >= 2) {
					splitIndices.push(brStart);
				}
				brCount = 0;
			}
		}

		if (splitIndices.length === 0) {
			continue;
		}

		// Build segments between split points
		const segments: Node[][] = [];
		let segStart = 0;

		for (const splitStart of splitIndices) {
			const segment = children.slice(segStart, splitStart);
			if (segment.length > 0) {
				segments.push(segment);
			}
			// Advance past the <br> sequence (and any surrounding whitespace)
			segStart = splitStart;
			while (segStart < children.length) {
				const node = children[segStart];
				const isBr = node.nodeType === Node.ELEMENT_NODE &&
					(node as Element).tagName.toLowerCase() === 'br';
				const isWhitespace = node.nodeType === Node.TEXT_NODE &&
					(node.textContent || '').trim() === '';
				if (!isBr && !isWhitespace) {
					break;
				}
				segStart++;
			}
		}

		// Final segment after last split
		const finalSegment = children.slice(segStart);
		if (finalSegment.length > 0) {
			segments.push(finalSegment);
		}

		// Filter out segments that only contain whitespace
		const nonEmptySegments = segments.filter(segment =>
			segment.some(n => {
				if (n.nodeType === Node.TEXT_NODE) {
					return (n.textContent || '').trim() !== '';
				}
				return n.nodeType === Node.ELEMENT_NODE;
			})
		);

		if (nonEmptySegments.length <= 1) {
			continue;
		}

		// Replace the original element with <p> paragraphs
		const fragment = doc.createDocumentFragment();
		for (const segment of nonEmptySegments) {
			const p = doc.createElement('p');
			for (const node of segment) {
				p.appendChild(node);
			}
			fragment.appendChild(p);
		}
		el.replaceWith(fragment);
	}
}

// Parse document content for clipping. In reader mode, extracts from
// the article's original HTML to avoid reader UI artifacts.
export function parseForClip(doc: Document) {
	const readerArticle = doc.querySelector('.obsidian-reader-active .obsidian-reader-content article');
	if (readerArticle) {
		const readerDoc = doc.implementation.createHTMLDocument();
		const originalHtml = readerArticle.getAttribute('data-original-html');
		if (originalHtml) {
			setElementHTML(readerDoc.body, originalHtml);
		} else {
			readerDoc.body.replaceChildren(
				...Array.from(readerArticle.childNodes).map(n => readerDoc.importNode(n, true))
			);
		}
		preprocessParagraphs(readerDoc);
		return new Defuddle(readerDoc, { url: '' }).parse();
	}
	preprocessParagraphs(doc);
	return new Defuddle(doc, { url: doc.URL }).parse();
}
