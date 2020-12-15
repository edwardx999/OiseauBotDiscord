import * as fetch from "node-fetch";
import * as xml from "xml2js";
import { makeCallOnce } from "./util";
export { fetchComposerList, ComposerData, fetchComposerPageSize, fetchComposerCategories }
interface ComposerData {
	name: string;
	dates?: string;
	pageUrl?: string;
	pageSize?: number;
}

const unknownDates = "Unknown dates";

function getDatesString(str?: string) {
	if (!str) {
		return unknownDates;
	}
	const lastParen = str.lastIndexOf(")");
	if (lastParen < 0) {
		return unknownDates;
	}
	const firstParen = str.lastIndexOf("(");
	if (firstParen >= 0 && firstParen < lastParen) {
		return str.substring(firstParen + 1, lastParen);
	}
	return unknownDates;
}

const wikiApiHeader = { "User-Agent": "Oiseaubot (https://github.com/edwardx999)" };

/**
 * Returns array of numbers where the ith number is the page size of the ith link. 
 * If an entry is undefined, the page size was not retrieved successfully.
 * Assumes pageLinks are unique.
 * 
 * @param pageLinks
 */
async function fetchComposerPageSize(pageLinks: string[]) {
	const prefix = "/wiki/";
	const pageSizes: number[] = [];
	const pageIndices: Record<string, number> = {};
	const pageTitles: string[] = [];
	pageLinks.forEach((link, index) => {
		if (link && link.startsWith(prefix)) {
			const title = link.substr(prefix.length);
			pageTitles.push(title);
			pageIndices[title] = index;
		}
		else {
			pageSizes[index] = 0;
		}
	});
	if (pageTitles.length === 0) {
		return pageSizes;
	}
	const titleQuery = pageTitles.join("|");
	const reqUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&titles=${titleQuery}&prop=revisions&rvprop=size`;
	try {
		const response = await fetch.default(reqUrl, {
			method: "GET",
			headers: wikiApiHeader
		});
		if (response.ok) {
			const body = await response.textConverted();
			const parsed = JSON.parse(body);
			const query = parsed.query;
			if (query) {
				const pages = query.pages;
				if (typeof pages === "object") {
					const normalized = (() => {
						const n = query.normalized;
						const ret: Record<string, string> = {};
						if (Array.isArray(n)) {
							for (const entry of n) {
								ret[entry.to] = entry.from;
							}
						}
						return ret;
					})();
					for (const pageid in pages) {
						const page = pages[pageid];
						const revisions = page.revisions;
						const title = page.title;
						let index = pageIndices[title];
						if (index === undefined) {
							index = pageIndices[normalized[title]];
							if (index === undefined) {
								continue;
							}
						}
						if (typeof revisions.length === "number" && revisions.length > 0) {
							const size = revisions[0].size;
							if (typeof size === "number") {
								pageSizes[index] = size;
							}
						}
					}
				}
			}

		}
	} catch { }
	return pageSizes;
}

const categoryPrefix = "Category:";

async function fetchComposerCategories(href?: string) {
	try {
		if (!href) {
			return [];
		}
		const prefix = "/wiki/";
		if (href.startsWith(prefix)) {
			const reqUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&titles=${href.substring(prefix.length)}&prop=categories&cllimit=max`;
			const response = await fetch.default(reqUrl, {
				method: "GET",
				headers: wikiApiHeader
			});
			if (response.ok) {
				const body = await response.textConverted();
				const parsed = JSON.parse(body);
				const pages = parsed?.query?.pages;
				for (const page in pages) {
					const list = pages[page].categories;
					if (Array.isArray(list)) {
						const categories: string[] = [];
						for (const cat of list) {
							if (typeof cat === "object") {
								const name = cat.title;
								if (typeof name === "string") {
									if (name.startsWith(categoryPrefix)) {
										categories.push(name.substring(categoryPrefix.length));
									}
									else {
										categories.push(name);
									}
								}
							}
						}
						return categories;
					}
					break;
				}
			}
		}
	}
	catch {
	}
	return [];
}

const listRequest = makeCallOnce<ComposerData[]>(async (resolve, reject) => {
	try {
		const wikipediaData = await fetch.default("https://en.wikipedia.org/wiki/List_of_composers_by_name");
		if (wikipediaData.ok) {
			const body = await wikipediaData.textConverted();
			const startTag = `<div class="div-col columns column-width`;
			const endTag = `</div>`;
			const composerList: ComposerData[] = [];
			let blockStart = 0;
			const xmlJobs: Promise<any>[] = [];
			while (true) {
				blockStart = body.indexOf(startTag, blockStart);
				if (blockStart < 0) {
					break;
				}
				let blockEnd = body.indexOf(endTag, blockStart + startTag.length);
				if (blockEnd < 0) {
					break;
				}
				blockEnd += endTag.length;
				xmlJobs.push(xml.parseStringPromise((body.substring(blockStart, blockEnd))));
				blockStart = blockEnd;
			}
			for (const job of xmlJobs) {
				const result = await job;
				const ul = result.div?.ul;
				if (ul) {
					const li = ul[0]?.li;
					if (li && li.length) {
						for (let i = 0; i < li.length; ++i) {
							const elem = li[i];
							if (elem.a) {
								const title = elem.a[0].$.title;
								const href = elem.a[0].$.href;
								const content = elem._;
								const name = elem.a[0]._;
								if (title && href && name) {
									if ((title as string).indexOf("page does not exist") >= 0) {
										composerList.push({ name: name, dates: getDatesString(content) })
									}
									else {
										composerList.push({ name: name, dates: getDatesString(content), pageUrl: href })
									}
								}
							}
						}
					}
				}
			}
			resolve(composerList);
		}
	} catch {
		reject();
	}
});

async function fetchComposerList() {
	return listRequest();
}
