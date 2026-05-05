import browser from './browser-polyfill';
import { NoteIndexEntry, SearchResult } from '../types/types';
import { generalSettings } from './storage-utils';
import { getNoteIndex } from './note-index';

const DEFAULT_CONTENT_PREVIEW_LENGTH = 2000;

// --- Tier 1: Local REST API ---

interface LocalRestApiSearchResult {
	filename: string;
	path: string;
	result: string;
	score?: number;
}

async function callRestApiSearch(
	endpoint: string,
	query: string,
	apiKey: string
): Promise<{ ok: boolean; data?: any; results?: any; raw?: any; error?: string }> {
	const { localRestApiUrl } = generalSettings;
	if (!localRestApiUrl) return { ok: false, error: 'No REST API URL configured' };

	const url = `${localRestApiUrl.replace(/\/$/, '')}${endpoint}${encodeURIComponent(query)}`;
	console.log('[SelectionSearch] REST API request:', url);

	const response = await browser.runtime.sendMessage({
		action: 'obsidianRestApiSearch',
		url,
		apiKey,
	}) as { ok: boolean; data?: any; results?: any; raw?: any; error?: string };

	console.log('[SelectionSearch] REST API raw response:', response);
	return response;
}

function normalizeApiScore(score: number): number {
	if (typeof score !== 'number' || isNaN(score)) return 0.85;
	if (score >= 0 && score <= 1) return score;
	if (score > 1 && score <= 100) return score / 100;
	// Negative or very large raw scores (e.g. BM25) — treat as high relevance
	return 0.85;
}

function mapRestApiResults(raw: any[]): SearchResult[] {
	if (!Array.isArray(raw)) {
		console.warn('[SelectionSearch] REST API response is not an array:', raw);
		return [];
	}
	return raw.map((r: any) => ({
		title: ((r.filename || r.file || r.title || 'Unknown') as string).replace(/\.md$/, ''),
		path: (r.path || r.file || r.filename || '') as string,
		vault: (r.vault || '') as string,
		similarity: normalizeApiScore(typeof r.score === 'number' ? r.score : typeof r.relevance === 'number' ? r.relevance : 0.85),
		matchType: 'content' as const,
		snippet: ((r.result || r.content || r.snippet || '') as string).substring(0, 300),
	}));
}

function buildPathQueryConstraint(): string {
	const { searchPaths } = generalSettings;
	if (!searchPaths || !searchPaths.trim()) return '';
	const paths = searchPaths.split(',').map(p => p.trim()).filter(Boolean);
	if (paths.length === 0) return '';
	if (paths.length === 1) return `path:${paths[0]} `;
	return paths.map(p => `path:${p}`).join(' OR ') + ' ';
}

async function searchViaLocalRestApi(
	query: string,
	vault?: string
): Promise<{ results: SearchResult[]; error?: string }> {
	const { localRestApiUrl, localRestApiKey } = generalSettings;
	console.log('[SelectionSearch] searchViaLocalRestApi called, URL configured:', localRestApiUrl || '(none)');
	if (!localRestApiUrl) {
		return { results: [] };
	}

	// The /search/simple/ endpoint uses plain text fuzzy search (Obsidian's built-in search).
	// It does NOT support Obsidian search syntax like "path:", so we only use plain queries.
	// Try progressively shorter queries to maximize chance of match.
	const queries = [query];
	if (query.length > 15) queries.push(query.slice(0, 15));
	if (query.length > 8) queries.push(query.slice(0, 8));

	console.log('[SelectionSearch] REST API queries:', queries);

	// Only /search/simple/ works with POST + query param.
	// /search/ (DQL/JsonLogic) requires a request body and returns 400 with query params.
	const endpoints = ['/search/simple/?query=', '/search/simple?query='];

	let lastError = '';
	for (const endpoint of endpoints) {
		for (const q of queries) {
			const response = await callRestApiSearch(endpoint, q, localRestApiKey);
			if (!response.ok) {
				lastError = response.error || '';
				console.error(`[SelectionSearch] ${endpoint} failed for "${q}":`, response.error);
				continue;
			}
			const rawResults = Array.isArray(response.data)
				? response.data
				: Array.isArray(response.data?.results)
					? response.data.results
					: Array.isArray(response.results)
						? response.results
						: Array.isArray(response.raw)
							? response.raw
							: Array.isArray(response.raw?.results)
								? response.raw.results
								: [];
			console.log(`[SelectionSearch] ${endpoint} "${q}" returned ${rawResults.length} raw results`);
			if (rawResults.length > 0) {
				const mapped = mapRestApiResults(rawResults);
				if (mapped.length > 0) {
					return { results: mapped };
				}
			}
		}
	}

	return { results: [], error: lastError || 'REST API search returned no results for any query variation' };
}

// --- Similarity Algorithm ---

function generateNGrams(text: string, n: number): Set<string> {
	const normalized = text.toLowerCase()
		.replace(/\s+/g, ' ')
		.replace(/[^\w\s]/g, '')
		.trim();

	const grams = new Set<string>();
	for (let i = 0; i <= normalized.length - n; i++) {
		grams.add(normalized.slice(i, i + n));
	}
	return grams;
}

function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
	if (setA.size === 0 && setB.size === 0) return 1.0;
	const intersection = new Set([...setA].filter(x => setB.has(x)));
	const union = new Set([...setA, ...setB]);
	return intersection.size / union.size;
}

export function computeContentSimilarity(textA: string, textB: string): number {
	const gramsA = generateNGrams(textA, 3);
	const gramsB = generateNGrams(textB, 3);
	return jaccardSimilarity(gramsA, gramsB);
}

function normalizeUrl(url: string): string {
	try {
		const parsed = new URL(url);
		parsed.hash = '';
		parsed.search = '';
		return parsed.toString();
	} catch {
		return url;
	}
}

// --- Search Orchestration ---

export async function searchNotes(
	queryText: string,
	pageUrl?: string,
	pageTitle?: string
): Promise<SearchResult[]> {
	console.log('[SelectionSearch] searchNotes called, text length:', queryText.length, 'url:', pageUrl, 'title:', pageTitle);
	const threshold = generalSettings.searchSimilarityThreshold || 0.8;
	console.log('[SelectionSearch] threshold:', threshold, 'REST API URL:', generalSettings.localRestApiUrl || '(none)');

	// Try REST API first
	const { results: apiResults, error: apiError } = await searchViaLocalRestApi(queryText);
	console.log('[SelectionSearch] REST API results:', apiResults.length, 'error:', apiError || '(none)');
	let allResults: SearchResult[] = [];
	if (apiResults.length > 0) {
		// Log each result's similarity for diagnostics
		apiResults.forEach((r, i) => console.log(`[SelectionSearch] API result ${i}: title="${r.title}" similarity=${r.similarity} matchType=${r.matchType}`));
		// Don't filter REST API results by local threshold — the API already ranked them.
		// Just take top 10 to avoid overwhelming the UI.
		allResults = allResults.concat(apiResults.slice(0, 10));
	}
	// Always search internal index too for notes saved via the extension.

	// Search internal index
	const index = await getNoteIndex();
	console.log('[SelectionSearch] internal index size:', index.length);
	const queryGrams = generateNGrams(queryText, 3);

	for (const entry of index) {
		let matchType: SearchResult['matchType'] = 'content';
		let similarity = 0;

		// Priority 1: Exact URL match
		if (pageUrl && entry.url && normalizeUrl(entry.url) === normalizeUrl(pageUrl)) {
			similarity = 1.0;
			matchType = 'url';
		}
		// Priority 2: Exact title match (page title vs note title)
		else if (pageTitle && entry.title.toLowerCase().trim() === pageTitle.toLowerCase().trim()) {
			similarity = 1.0;
			matchType = 'title';
		}
		// Priority 2b: Query text is contained in note title (substring match)
		else if (queryText && entry.title.toLowerCase().includes(queryText.toLowerCase())) {
			similarity = 0.95;
			matchType = 'title';
		}
		// Priority 2c: Note title is contained in query text (reverse substring)
		else if (queryText && queryText.toLowerCase().includes(entry.title.toLowerCase())) {
			similarity = 0.95;
			matchType = 'title';
		}
		// Priority 3: Content similarity
		else {
			const entryGrams = generateNGrams(entry.content, 3);
			similarity = jaccardSimilarity(queryGrams, entryGrams);
		}

		if (similarity >= threshold) {
			allResults.push({
				title: entry.title,
				path: entry.path,
				vault: entry.vault,
				similarity,
				matchType,
				snippet: entry.content.substring(0, 200),
			});
		}
	}

	// Deduplicate by vault+path
	const seen = new Set<string>();
	const deduped = allResults.filter(r => {
		const key = `${r.vault}::${r.path}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	// Sort by similarity descending
	deduped.sort((a, b) => b.similarity - a.similarity);

	// Return top 10
	const finalResults = deduped.slice(0, 10);
	console.log('[SelectionSearch] final results:', finalResults.length);
	return finalResults;
}
