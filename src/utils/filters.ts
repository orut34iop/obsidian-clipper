import {
	applyFiltersWithRegistry,
	standardFilters,
	type FilterRegistry,
	type TemplateFilter,
} from 'knap';
import { htmlFilters } from 'knap/html';
import { markdown } from './filters/markdown';

export interface ClipperTemplateContext {
	currentUrl?: string;
	tabId?: number;
}

const markdownFilter: TemplateFilter<ClipperTemplateContext> = (value, param, filterContext) =>
	markdown(value, param ?? filterContext?.context?.currentUrl);
markdownFilter.metadata = {};

const fragmentLinkFilter: TemplateFilter<ClipperTemplateContext> = (value, param, filterContext) => {
	const combinedParam = [param, filterContext?.context?.currentUrl].filter(Boolean).join(':');
	return standardFilters.fragment_link(value, combinedParam, filterContext);
};
fragmentLinkFilter.metadata = {};

/** Knap's shared filters plus the browser/Defuddle filters enabled by Clipper. */
export const clipperFilters: Readonly<FilterRegistry<ClipperTemplateContext>> = Object.freeze({
	...standardFilters,
	...htmlFilters,
	markdown: markdownFilter,
	fragment_link: fragmentLinkFilter,
});

const diagnosticFilters = new Proxy(clipperFilters, {
	get(target, property, receiver) {
		if (typeof property === 'string' && !Reflect.has(target, property)) {
			console.error(`Invalid filter: ${property}`);
		}
		return Reflect.get(target, property, receiver);
	},
});

/** Apply a filter chain in Clipper-only post-processing paths. */
export function applyFilters(
	value: string | any[],
	filterString: string,
	currentUrl?: string,
): string {
	return applyFiltersWithRegistry(value, filterString, diagnosticFilters, {
		variables: {},
		context: { currentUrl },
	});
}
