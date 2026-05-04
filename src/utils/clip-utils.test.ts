// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { preprocessParagraphs } from './clip-utils';

function createDoc(html: string): Document {
	const parser = new DOMParser();
	return parser.parseFromString(`<html><body>${html}</body></html>`, 'text/html');
}

describe('preprocessParagraphs', () => {
	it('splits text separated by two br tags into paragraphs', () => {
		const doc = createDoc('<div>第一段<br><br>第二段</div>');
		preprocessParagraphs(doc);

		const ps = doc.querySelectorAll('p');
		expect(ps).toHaveLength(2);
		expect(ps[0].textContent).toBe('第一段');
		expect(ps[1].textContent).toBe('第二段');
	});

	it('handles br tags separated by whitespace text nodes', () => {
		const doc = createDoc('<div>第一段<br>\n  <br>第二段</div>');
		preprocessParagraphs(doc);

		const ps = doc.querySelectorAll('p');
		expect(ps).toHaveLength(2);
		expect(ps[0].textContent).toBe('第一段');
		expect(ps[1].textContent).toBe('第二段');
	});

	it('splits on three or more consecutive br tags', () => {
		const doc = createDoc('<div>第一段<br><br><br>第二段</div>');
		preprocessParagraphs(doc);

		const ps = doc.querySelectorAll('p');
		expect(ps).toHaveLength(2);
	});

	it('preserves inline elements inside each paragraph', () => {
		const doc = createDoc('<div><strong>第一段</strong><br><br><a href="/x">第二段</a></div>');
		preprocessParagraphs(doc);

		const ps = doc.querySelectorAll('p');
		expect(ps).toHaveLength(2);
		expect(ps[0].innerHTML).toBe('<strong>第一段</strong>');
		expect(ps[1].innerHTML).toBe('<a href="/x">第二段</a>');
	});

	it('does not process elements that already contain p children', () => {
		const doc = createDoc('<div><p>第一段</p><br><br><p>第二段</p></div>');
		preprocessParagraphs(doc);

		const ps = doc.querySelectorAll('p');
		expect(ps).toHaveLength(2);
		expect(ps[0].textContent).toBe('第一段');
		expect(ps[1].textContent).toBe('第二段');
	});

	it('does not process single br tags', () => {
		const doc = createDoc('<div>第一段<br>第二段</div>');
		preprocessParagraphs(doc);

		const ps = doc.querySelectorAll('p');
		expect(ps).toHaveLength(0);
		expect(doc.body.querySelector('div')?.innerHTML).toBe('第一段<br>第二段');
	});

	it('ignores br sequences inside pre elements', () => {
		const doc = createDoc('<pre><div>第一段<br><br>第二段</div></pre>');
		preprocessParagraphs(doc);

		const ps = doc.querySelectorAll('p');
		expect(ps).toHaveLength(0);
	});

	it('ignores leading and trailing br sequences', () => {
		const doc = createDoc('<div><br><br>第一段<br><br>第二段<br><br></div>');
		preprocessParagraphs(doc);

		const ps = doc.querySelectorAll('p');
		expect(ps).toHaveLength(2);
		expect(ps[0].textContent).toBe('第一段');
		expect(ps[1].textContent).toBe('第二段');
	});

	it('handles multiple splits in one element', () => {
		const doc = createDoc('<div>第一段<br><br>第二段<br><br>第三段</div>');
		preprocessParagraphs(doc);

		const ps = doc.querySelectorAll('p');
		expect(ps).toHaveLength(3);
		expect(ps[0].textContent).toBe('第一段');
		expect(ps[1].textContent).toBe('第二段');
		expect(ps[2].textContent).toBe('第三段');
	});

	it('does not create empty paragraphs from empty segments', () => {
		const doc = createDoc('<div>第一段<br><br><br><br>第二段</div>');
		preprocessParagraphs(doc);

		const ps = doc.querySelectorAll('p');
		expect(ps).toHaveLength(2);
	});

	it('processes nested divs independently', () => {
		const doc = createDoc(`
			<div>
				<div>A<br><br>B</div>
				<div>C<br><br>D</div>
			</div>
		`);
		preprocessParagraphs(doc);

		const ps = doc.querySelectorAll('p');
		expect(ps).toHaveLength(4);
	});

	it('removes plain-text alternative when HTML version exists (joinquant pattern)', () => {
		const doc = createDoc(`
			<div class="jq-c-markdown-render">
				<div class="jq-c-markdown-render-text">一、\n忘记...\n\n二、\n简要...</div>
				<div class="jq-c-markdown-render-html">
					<p>一、<br>忘记...</p>
					<p>二、<br>简要...</p>
				</div>
			</div>
		`);
		preprocessParagraphs(doc);

		expect(doc.querySelector('.jq-c-markdown-render-text')).toBeNull();
		expect(doc.querySelectorAll('.jq-c-markdown-render-html p')).toHaveLength(2);
	});

	it('keeps plain-text when no HTML sibling exists', () => {
		const doc = createDoc(`
			<div class="jq-c-markdown-render">
				<div class="jq-c-markdown-render-text">一、\n忘记...</div>
			</div>
		`);
		preprocessParagraphs(doc);

		expect(doc.querySelector('.jq-c-markdown-render-text')).not.toBeNull();
	});

	it('splits p elements that use br br as paragraph separators', () => {
		const doc = createDoc('<p>第一段<br><br>第二段</p>');
		preprocessParagraphs(doc);

		const ps = doc.querySelectorAll('p');
		expect(ps).toHaveLength(2);
		expect(ps[0].textContent).toBe('第一段');
		expect(ps[1].textContent).toBe('第二段');
	});

	it('preserves single br inside p elements', () => {
		const doc = createDoc('<p>第一行<br>第二行</p>');
		preprocessParagraphs(doc);

		const ps = doc.querySelectorAll('p');
		expect(ps).toHaveLength(1);
		expect(ps[0].innerHTML).toBe('第一行<br>第二行');
	});
});
