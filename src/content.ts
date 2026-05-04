import browser from './utils/browser-polyfill';
import * as highlighter from './utils/highlighter';
import { removeExistingHighlights } from './utils/highlighter-overlays';
import { loadSettings, generalSettings } from './utils/storage-utils';
import { getDomain } from './utils/string-utils';
import { extractContentBySelector as extractContentBySelectorShared } from './utils/shared';
import Defuddle from 'defuddle';
import { createMarkdownContent } from 'defuddle/full';
import { flattenShadowDom } from './utils/flatten-shadow-dom';
import { serializeChildren } from './utils/dom-utils';
import { saveFile } from './utils/file-utils';
import { debugLog } from './utils/debug';
import { updateSidebarWidth, addResizeHandle, cleanupResizeHandlers } from './utils/iframe-resize';
import { parseForClip, preprocessParagraphs } from './utils/clip-utils';
import { getMessage } from './utils/i18n';
import { searchNotes } from './utils/selection-search';

declare global {
	interface Window {
		obsidianClipperGeneration?: number;
	}
}

// IIFE to scope variables and allow safe re-execution
(async function() {
	// Bump the generation counter on every injection. Older listeners close
	// over their own generation value and bail out when they see a newer one,
	// so a zombie content script (runtime invalidated after extension update)
	// will silently yield to the freshly-injected instance.
	window.obsidianClipperGeneration = (window.obsidianClipperGeneration ?? 0) + 1;
	const myGeneration = window.obsidianClipperGeneration;

	debugLog('Clipper', 'Initializing content script, generation', myGeneration);
	console.log('[Clipper] Content script initializing, generation:', myGeneration);

	// Ensure settings are loaded before any feature checks
	await loadSettings();
	console.log('[Clipper] Settings loaded, selectionSearchEnabled:', generalSettings.selectionSearchEnabled);

	let isHighlighterMode = false;
	const iframeId = 'obsidian-clipper-iframe';
	const containerId = 'obsidian-clipper-container';

	function removeContainer(container: HTMLElement) {
		container.classList.add('is-closing');
		updateSidebarWidth(document, null);
		cleanupResizeHandlers(document);
		container.addEventListener('animationend', () => {
			container.remove();
			highlighter.repositionHighlights();
		}, { once: true });
	}

	async function toggleIframe() {
		const existingContainer = document.getElementById(containerId);
		if (existingContainer) {
			removeContainer(existingContainer);
			return;
		}

		await ensureHighlighterCSS();

		const container = document.createElement('div');
		container.id = containerId;
		container.classList.add('is-open');

		const { clipperIframeWidth, clipperIframeHeight } = await browser.storage.local.get(['clipperIframeWidth', 'clipperIframeHeight']);
		if (clipperIframeWidth) {
			container.style.width = `${clipperIframeWidth}px`;
		}
		if (clipperIframeHeight) {
			container.style.height = `${clipperIframeHeight}px`;
		}

		const iframe = document.createElement('iframe');
		iframe.id = iframeId;
		iframe.allow = 'clipboard-write; web-share';
		iframe.src = browser.runtime.getURL('side-panel.html?context=iframe');
		container.appendChild(iframe);

		const resizeCallbacks = {
			onResize: () => highlighter.repositionHighlights(),
			onResizeEnd: () => highlighter.repositionHighlights(),
		};
		addResizeHandle(document, container, 'w', resizeCallbacks);
		addResizeHandle(document, container, 's', resizeCallbacks);
		addResizeHandle(document, container, 'sw', resizeCallbacks);

		document.body.appendChild(container);
		updateSidebarWidth(document, container);
		container.addEventListener('animationend', () => highlighter.repositionHighlights(), { once: true });
	}

	// Firefox
	browser.runtime.sendMessage({ action: "contentScriptLoaded" });

	interface ContentResponse {
		content: string;
		selectedHtml: string;
		extractedContent: { [key: string]: string };
		schemaOrgData: any;
		fullHtml: string;
		highlights: string[];
		title: string;
		description: string;
		domain: string;
		favicon: string;
		image: string;
		parseTime: number;
		published: string;
		author: string;
		site: string;
		wordCount: number;
		language: string;
		metaTags: { name?: string | null; property?: string | null; content: string | null }[];
	}

	browser.runtime.onMessage.addListener((request: any, sender, sendResponse) => {
		// If a newer generation of this content script has been injected,
		// yield to it rather than responding from a potentially stale context.
		if (window.obsidianClipperGeneration !== myGeneration) {
			return;
		}

		if (request.action === "ping") {
			sendResponse({});
			return true;
		}

		if (request.action === "toggle-iframe") {
			toggleIframe().then(() => {
				sendResponse({ success: true });
			});
			return true;
		}

		if (request.action === "close-iframe") {
			const existingContainer = document.getElementById(containerId);
			if (existingContainer) {
				removeContainer(existingContainer);
			}
			return;
		}

		if (request.action === "copy-text-to-clipboard") {
			const textArea = document.createElement("textarea");
			textArea.value = request.text;
			document.body.appendChild(textArea);
			textArea.select();
			try {
				document.execCommand('copy');
				sendResponse({success: true});
			} catch (err) {
				sendResponse({success: false});
			}
			document.body.removeChild(textArea);
			return true;
		}

		if (request.action === "copyMarkdownToClipboard") {
			flattenShadowDom(document).then(() => {
				try {
					const defuddled = parseForClip(document);

					// Convert HTML content to markdown
					const markdown = createMarkdownContent(defuddled.content, document.URL);

					// Copy to clipboard
					const textArea = document.createElement("textarea");
					textArea.value = markdown;
					document.body.appendChild(textArea);
					textArea.select();
					document.execCommand('copy');
					document.body.removeChild(textArea);

					sendResponse({ success: true });
				} catch (err) {
					console.error('Failed to copy markdown to clipboard:', err);
					sendResponse({ success: false, error: (err as Error).message });
				}
			});
			return true;
		}

		if (request.action === "saveMarkdownToFile") {
			flattenShadowDom(document).then(async () => {
				try {
					const defuddled = parseForClip(document);
					const markdown = createMarkdownContent(defuddled.content, document.URL);
					const title = defuddled.title || document.title || 'Untitled';
					const fileName = title.replace(/[/\\?%*:|"<>]/g, '-');
					await saveFile({
						content: markdown,
						fileName,
						mimeType: 'text/markdown',
					});
					sendResponse({ success: true });
				} catch (err) {
					console.error('Failed to save markdown file:', err);
					sendResponse({ success: false, error: (err as Error).message });
				}
			});
			return true;
		}

		if (request.action === "getPageContent") {
			// Flatten shadow DOM before extraction (async, needs main world)
			const flattenTimeout = new Promise<void>(resolve => setTimeout(resolve, 3000));
			Promise.race([flattenShadowDom(document), flattenTimeout]).then(async () => {
				let selectedHtml = '';
				const selection = window.getSelection();

				if (selection && selection.rangeCount > 0) {
					const range = selection.getRangeAt(0);
					const clonedSelection = range.cloneContents();
					const div = document.createElement('div');
					div.appendChild(clonedSelection);
					selectedHtml = serializeChildren(div);
				}

				preprocessParagraphs(document);

				// Use parseAsync to ensure async variables like {{transcript}} are available.
				// If it hangs (e.g. another extension has corrupted fetch), fall back to sync parse.
				const defuddle = new Defuddle(document, { url: document.URL });
				const parseTimeout = new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('parseAsync timeout')), 8000)
				);
				const defuddled = await Promise.race([defuddle.parseAsync(), parseTimeout])
					.catch(() => defuddle.parse());
				const extractedContent: { [key: string]: string } = {
					...defuddled.variables,
				};

				// Create a new DOMParser
				const parser = new DOMParser();
				// Parse the document's HTML
				const doc = parser.parseFromString(document.documentElement.outerHTML, 'text/html');

				// Remove all script and style elements
				doc.querySelectorAll('script, style').forEach(el => el.remove());

				// Remove style attributes from all elements
				doc.querySelectorAll('*').forEach(el => el.removeAttribute('style'));

				// Convert all relative URLs to absolute
				doc.querySelectorAll('[src], [href]').forEach(element => {
					['src', 'href', 'srcset'].forEach(attr => {
						const value = element.getAttribute(attr);
						if (!value) return;

						if (attr === 'srcset') {
							const newSrcset = value.split(',').map(src => {
								const [url, size] = src.trim().split(' ');
								try {
									const absoluteUrl = new URL(url, document.baseURI).href;
									return `${absoluteUrl}${size ? ' ' + size : ''}`;
								} catch (e) {
									return src;
								}
							}).join(', ');
							element.setAttribute(attr, newSrcset);
						} else if (!value.startsWith('http') && !value.startsWith('data:') && !value.startsWith('#') && !value.startsWith('//')) {
							try {
								const absoluteUrl = new URL(value, document.baseURI).href;
								element.setAttribute(attr, absoluteUrl);
							} catch (e) {
								console.warn(`Failed to process ${attr} URL:`, value);
							}
						}
					});
				});

				// Get the modified HTML without scripts, styles, and style attributes
				const cleanedHtml = doc.documentElement.outerHTML;

				const response: ContentResponse = {
					author: defuddled.author,
					content: defuddled.content,
					description: defuddled.description,
					domain: getDomain(document.URL),
					extractedContent: extractedContent,
					favicon: defuddled.favicon,
					fullHtml: cleanedHtml,
					highlights: highlighter.getHighlights(),
					image: defuddled.image,
					language: defuddled.language || '',
					parseTime: defuddled.parseTime,
					published: defuddled.published,
					schemaOrgData: defuddled.schemaOrgData,
					selectedHtml: selectedHtml,
					site: defuddled.site,
					title: defuddled.title,
					wordCount: defuddled.wordCount,
					metaTags: defuddled.metaTags || []
				};
				if (defuddled.title) {
					highlighter.setPageTitle(defuddled.title);
				}
				highlighter.updatePageDomainSettings({ site: defuddled.site, favicon: defuddled.favicon });
				sendResponse(response);
			}).catch((error: unknown) => {
				console.error('[Obsidian Clipper] getPageContent error:', error);
				sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
			});
			return true;
		} else if (request.action === "extractContent") {
			const content = extractContentBySelector(request.selector, request.attribute, request.extractHtml);
			sendResponse({ content: content });
		} else if (request.action === "paintHighlights") {
			ensureHighlighterCSS().then(() => highlighter.loadHighlights()).then(() => {
				if (generalSettings.alwaysShowHighlights) {
					highlighter.applyHighlights();
				}
				sendResponse({ success: true });
			});
			return true;
		} else if (request.action === "setHighlighterMode") {
			isHighlighterMode = request.isActive;
			ensureHighlighterCSS();
			highlighter.toggleHighlighterMenu(isHighlighterMode);
			updateHasHighlights();
			sendResponse({ success: true });
			return true;
		} else if (request.action === "getHighlighterMode") {
			browser.runtime.sendMessage({ action: "getHighlighterMode" }).then(sendResponse);
			return true;
		} else if (request.action === "toggleHighlighter") {
			ensureHighlighterCSS();
			highlighter.toggleHighlighterMenu(request.isActive);
			updateHasHighlights();
			sendResponse({ success: true });
		} else if (request.action === "highlightSelection") {
			ensureHighlighterCSS();
			highlighter.toggleHighlighterMenu(request.isActive);
			const selection = window.getSelection();
			if (selection && !selection.isCollapsed) {
				highlighter.handleTextSelection(selection);
			}
			updateHasHighlights();
			sendResponse({ success: true });
		} else if (request.action === "highlightElement") {
			ensureHighlighterCSS();
			highlighter.toggleHighlighterMenu(request.isActive);
			if (request.targetElementInfo) {
				const { mediaType, srcUrl, pageUrl } = request.targetElementInfo;
				
				let elementToHighlight: Element | null = null;

				// Function to compare URLs, handling both absolute and relative paths
				const urlMatches = (elementSrc: string, targetSrc: string) => {
					const elementUrl = new URL(elementSrc, pageUrl);
					const targetUrl = new URL(targetSrc, pageUrl);
					return elementUrl.href === targetUrl.href;
				};

				// Try to find the element using the src attribute
				elementToHighlight = document.querySelector(`${mediaType}[src="${srcUrl}"]`);

				// If not found, try with relative URL
				if (!elementToHighlight) {
					const relativeSrc = new URL(srcUrl).pathname;
					elementToHighlight = document.querySelector(`${mediaType}[src="${relativeSrc}"]`);
				}

				// If still not found, iterate through all elements of the media type
				if (!elementToHighlight) {
					const elements = Array.from(document.getElementsByTagName(mediaType));
					for (const el of elements) {
						if (el instanceof HTMLImageElement || el instanceof HTMLVideoElement || el instanceof HTMLAudioElement) {
							if (urlMatches(el.src, srcUrl)) {
								elementToHighlight = el;
								break;
							}
						}
					}
				}

				if (elementToHighlight) {
					highlighter.highlightElement(elementToHighlight);
				} else {
					console.warn('Could not find element to highlight. Info:', request.targetElementInfo);
				}
			}
			updateHasHighlights();
			sendResponse({ success: true });
		} else if (request.action === "clearHighlights") {
			highlighter.clearHighlights();
			updateHasHighlights();
			sendResponse({ success: true });
		} else if (request.action === "getHighlighterState") {
			browser.runtime.sendMessage({ action: "getHighlighterMode" })
				.then(response => {
					sendResponse(response);
				})
				.catch(error => {
					console.error("Error getting highlighter mode:", error);
					sendResponse({ isActive: false });
				});
			return true;
		} else if (request.action === "getReaderModeState") {
			sendResponse({ isActive: document.documentElement.classList.contains('obsidian-reader-active') });
			return true;
		}
		return true;
	});

	function extractContentBySelector(selector: string, attribute?: string, extractHtml: boolean = false): string | string[] {
		return extractContentBySelectorShared(document, selector, attribute, extractHtml);
	}

	function updateHasHighlights() {
		const hasHighlights = highlighter.getHighlights().length > 0;
		browser.runtime.sendMessage({ action: "updateHasHighlights", hasHighlights });
	}

	let highlighterCSSPromise: Promise<void> | null = null;
	function ensureHighlighterCSS(): Promise<void> {
		if (!highlighterCSSPromise) {
			highlighterCSSPromise = new Promise<void>((resolve) => {
				const link = document.createElement('link');
				link.rel = 'stylesheet';
				link.href = browser.runtime.getURL('highlighter.css');
				link.onload = () => resolve();
				link.onerror = () => resolve();
				(document.head || document.documentElement).appendChild(link);
			});
		}
		return highlighterCSSPromise;
	}

	async function initializeHighlighter() {
		await loadSettings();

		if (generalSettings.alwaysShowHighlights) {
			const result = await browser.storage.local.get('highlights');
			const allHighlights = (result.highlights || {}) as Record<string, unknown>;
			if (allHighlights[window.location.href]) {
				await ensureHighlighterCSS();
			}
		}

		await highlighter.loadHighlights();
		highlighter.setPageTitle(document.title);
		updateHasHighlights();
	}

	// Initialize highlighter
	initializeHighlighter();

	// Expose highlighter API on window so reader-script.js (a separate
	// webpack bundle injected when reader mode activates) can delegate
	// all state operations to this single module instance. Without this,
	// both bundles own a copy of highlighter.ts with independent mutable
	// state — the bridge ensures one source of truth per tab.
	window.__obsidianHighlighter = {
		toggleHighlighterMenu: highlighter.toggleHighlighterMenu,
		handleTextSelection: highlighter.handleTextSelection,
		highlightElement: highlighter.highlightElement,
		applyHighlights: highlighter.applyHighlights,
		loadHighlights: highlighter.loadHighlights,
		invalidateHighlightCache: highlighter.invalidateHighlightCache,
		repositionHighlights: highlighter.repositionHighlights,
		getHighlights: highlighter.getHighlights,
		setPageUrl: highlighter.setPageUrl,
		setPageTitle: highlighter.setPageTitle,
		updatePageDomainSettings: highlighter.updatePageDomainSettings,
		clearHighlights: highlighter.clearHighlights,
		saveHighlights: highlighter.saveHighlights,
		updateHighlighterMenu: highlighter.updateHighlighterMenu,
		removeExistingHighlights,
		ensureHighlighterCSS: () => { ensureHighlighterCSS(); },
	} satisfies highlighter.HighlighterAPI;

	// Call updateHasHighlights when the page loads
	window.addEventListener('load', updateHasHighlights);

	// Deactivate highlighter mode on unload
	function handlePageUnload() {
		if (isHighlighterMode) {
			highlighter.toggleHighlighterMenu(false);
			browser.runtime.sendMessage({ action: "highlighterModeChanged", isActive: false });
			browser.storage.local.set({ isHighlighterMode: false });
		}
	}

	window.addEventListener('beforeunload', handlePageUnload);

	// Listen for custom events from the reader script
	document.addEventListener('obsidian-reader-init', async () => {
		// Find the highlighter button
		const button = document.querySelector('[data-action="toggle-highlighter"]');
		if (button) {
			// Handle highlighter button clicks
			button.addEventListener('click', async (e) => {
				try {
					// First try to get the tab ID from the background script
					const response = await browser.runtime.sendMessage({ action: "ensureContentScriptLoaded" });
					
					let tabId: number | undefined;
					if (response && typeof response === 'object') {
						tabId = (response as { tabId: number }).tabId;
					}

					// If we didn't get a tab ID, try to get it from the background script
					if (!tabId) {
						try {
							const response = await browser.runtime.sendMessage({ action: "getActiveTab" }) as { tabId?: number; error?: string };
							if (response && !response.error && response.tabId) {
								tabId = response.tabId;
							}
						} catch (error) {
							console.error('[Content] Failed to get tab ID from background script:', error);
						}
					}

					if (tabId) {
						await browser.runtime.sendMessage({ action: "toggleHighlighterMode", tabId });
					} else {
						console.error('[Content]','Could not determine tab ID');
					}
				} catch (error) {
					console.error('[Content]','Error in toggle flow:', error);
				}
			});
		}
	});


	// Reload settings when they change in another context (e.g. settings page)
	browser.storage.onChanged.addListener((changes, area) => {
		if (area === 'sync' && changes.selection_search_settings) {
			loadSettings();
		}
	});

	// --- Selection Search Floating Button ---

	let selectionSearchButton: HTMLButtonElement | null = null;
	let selectionSearchPopup: HTMLDivElement | null = null;
	let currentSelectionText = '';

	const IGNORED_SELECTION_SELECTOR =
		'.obsidian-highlighter-menu, .obsidian-reader-settings, .obsidian-highlight-delete, .obsidian-selection-action, .obsidian-selection-search, #obsidian-clipper-container, .obsidian-selection-search-popup';

	function ensureSelectionSearchButton(): HTMLButtonElement {
		if (selectionSearchButton) return selectionSearchButton;

		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'obsidian-selection-search';
		btn.setAttribute('aria-label', getMessage('searchInObsidian'));
		btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg><span>${getMessage('searchInObsidian')}</span>`;
		btn.style.display = 'none';
		btn.style.position = 'absolute';
		btn.style.zIndex = '999999999';

		btn.addEventListener('mousedown', e => e.preventDefault());
		btn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			handleSelectionSearch();
		});

		document.body.appendChild(btn);
		selectionSearchButton = btn;
		return btn;
	}

	function showSelectionSearchButton(selection: Selection) {
		if (!generalSettings.selectionSearchEnabled) return;

		const range = selection.getRangeAt(0);
		const container = range.commonAncestorContainer;
		if (container.nodeType === Node.ELEMENT_NODE) {
			if ((container as Element).closest(IGNORED_SELECTION_SELECTOR)) return;
		} else if (container.parentElement?.closest(IGNORED_SELECTION_SELECTOR)) return;

		const text = selection.toString().trim();
		if (text.length < 10) return;

		currentSelectionText = text;

		const rects = range.getClientRects();
		if (rects.length === 0) return;
		const last = rects[rects.length - 1];

		ensureHighlighterCSS();

		const btn = ensureSelectionSearchButton();
		btn.style.display = 'flex';

		const btnWidth = btn.offsetWidth || 120;
		const idealLeft = last.left + (last.width / 2) - (btnWidth / 2);
		const clampedLeft = Math.max(4, Math.min(idealLeft, window.innerWidth - btnWidth - 4));

		btn.style.left = `${clampedLeft + window.scrollX}px`;
		btn.style.top = `${last.bottom + window.scrollY + 8}px`;
	}

	function hideSelectionSearchButton() {
		if (selectionSearchButton && selectionSearchButton.style.display !== 'none') {
			selectionSearchButton.style.display = 'none';
		}
		hideSearchResultsPopup();
	}

	async function handleSelectionSearch() {
		if (!currentSelectionText) return;

		const btn = ensureSelectionSearchButton();
		btn.classList.add('is-searching');

		showSearchResultsPopup([
			{ title: getMessage('searching'), path: '', vault: '', similarity: 0, matchType: 'content' }
		], btn, true);

		try {
			const results = await searchNotes(currentSelectionText, document.URL, document.title);
			showSearchResultsPopup(results, btn);
		} catch (err) {
			console.error('[Clipper] Selection search failed:', err);
			showSearchResultsPopup([], btn, false, String(err));
		} finally {
			btn.classList.remove('is-searching');
		}
	}

	function ensureSearchResultsPopup(): HTMLDivElement {
		if (selectionSearchPopup) return selectionSearchPopup;

		const popup = document.createElement('div');
		popup.className = 'obsidian-selection-search-popup';
		popup.style.display = 'none';
		document.body.appendChild(popup);
		selectionSearchPopup = popup;
		return popup;
	}

	function showSearchResultsPopup(
		results: { title: string; path: string; vault: string; similarity: number; matchType: 'exact' | 'title' | 'content' | 'url'; snippet?: string }[],
		anchorBtn: HTMLButtonElement,
		isSearching = false,
		errorMessage?: string
	) {
		const popup = ensureSearchResultsPopup();
		popup.style.display = 'block';
		popup.textContent = '';
		popup.style.position = 'absolute';
		popup.style.zIndex = '999999999';

		if (isSearching) {
			const header = document.createElement('div');
			header.className = 'search-popup-header';
			header.textContent = getMessage('searching');
			popup.appendChild(header);

			const desc = document.createElement('div');
			desc.className = 'search-popup-no-results';
			desc.textContent = getMessage('searchingDescription');
			popup.appendChild(desc);

			positionPopup(popup, anchorBtn);
			return;
		}

		if (errorMessage) {
			const header = document.createElement('div');
			header.className = 'search-popup-header';
			header.textContent = getMessage('searchError');
			popup.appendChild(header);

			const desc = document.createElement('div');
			desc.className = 'search-popup-no-results';
			desc.textContent = errorMessage;
			popup.appendChild(desc);

			positionPopup(popup, anchorBtn);
			return;
		}

		const header = document.createElement('div');
		header.className = 'search-popup-header';
		header.textContent = results.length > 0
			? getMessage('similarNotesFound', [String(results.length)])
			: getMessage('noSimilarNotes');
		popup.appendChild(header);

		if (results.length === 0) {
			const desc = document.createElement('div');
			desc.className = 'search-popup-no-results';
			desc.textContent = getMessage('noSimilarNotesDescription');
			popup.appendChild(desc);
		} else {
			const list = document.createElement('div');
			list.className = 'search-popup-list';
			for (const r of results) {
				const item = document.createElement('div');
				item.className = 'search-popup-item';

				const title = document.createElement('div');
				title.className = 'search-popup-item-title';
				title.textContent = r.title;
				item.appendChild(title);

				const meta = document.createElement('div');
				meta.className = 'search-popup-item-meta';
				meta.textContent = `${r.vault}${r.path ? ' / ' + r.path : ''}`;
				item.appendChild(meta);

				const badge = document.createElement('span');
				badge.className = `search-popup-badge match-type-${r.matchType}`;
				const matchTypeKey = `matchType${r.matchType.charAt(0).toUpperCase() + r.matchType.slice(1)}` as const;
				badge.textContent = getMessage(matchTypeKey) || r.matchType;
				item.appendChild(badge);

				const similarity = document.createElement('span');
				similarity.className = 'search-popup-similarity';
				similarity.textContent = `${Math.round(r.similarity * 100)}%`;
				item.appendChild(similarity);

				if (r.snippet) {
					const snippet = document.createElement('div');
					snippet.className = 'search-popup-snippet';
					snippet.textContent = r.snippet;
					item.appendChild(snippet);
				}

				item.addEventListener('click', () => {
					const fileParam = r.path ? `&file=${encodeURIComponent(r.path.replace(/\.md$/, ''))}` : '';
					const url = `obsidian://open?vault=${encodeURIComponent(r.vault)}${fileParam}`;
					window.open(url, '_blank');
				});

				list.appendChild(item);
			}
			popup.appendChild(list);
		}

		positionPopup(popup, anchorBtn);
	}

	function positionPopup(popup: HTMLDivElement, anchorBtn: HTMLButtonElement) {
		const btnRect = anchorBtn.getBoundingClientRect();
		const popupWidth = popup.offsetWidth || 320;
		const idealLeft = btnRect.left + (btnRect.width / 2) - (popupWidth / 2);
		const clampedLeft = Math.max(4, Math.min(idealLeft, window.innerWidth - popupWidth - 4));
		popup.style.left = `${clampedLeft + window.scrollX}px`;
		popup.style.top = `${btnRect.bottom + window.scrollY + 8}px`;
	}

	function hideSearchResultsPopup() {
		if (selectionSearchPopup) {
			selectionSearchPopup.style.display = 'none';
		}
	}

	document.addEventListener('mouseup', (e) => {
		setTimeout(() => {
			if (myGeneration !== window.obsidianClipperGeneration) return;
			const selection = window.getSelection();
			const hasSelection = selection && !selection.isCollapsed && selection.toString().trim().length > 0;
			if (hasSelection) {
				showSelectionSearchButton(selection!);
			} else {
				const target = e.target as HTMLElement;
				if (!target.closest('.obsidian-selection-search, .obsidian-selection-search-popup')) {
					hideSelectionSearchButton();
				}
			}
		}, 10);
	}, true);

	window.addEventListener('scroll', hideSelectionSearchButton, { passive: true });
	window.addEventListener('resize', hideSelectionSearchButton);

	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') {
			hideSelectionSearchButton();
		}
	});

})();
