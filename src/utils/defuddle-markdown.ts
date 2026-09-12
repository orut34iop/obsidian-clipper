import Defuddle from 'defuddle/full';

// Defuddle's UMD bundle exposes this function on the default class. Node ESM
// cannot discover it as a named export when the dependency is externalized.
export const createMarkdownContent = (Defuddle as typeof Defuddle & {
	createMarkdownContent: typeof import('defuddle/full').createMarkdownContent;
}).createMarkdownContent;
