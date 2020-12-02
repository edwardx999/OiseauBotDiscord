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

async function fetchComposerPageSize(href?: string) {
	try {
		if (!href) {
			return 0;
		}
		const prefix = "/wiki/";
		if (href.startsWith(prefix)) {
			const reqUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&titles=${href.substring(prefix.length)}&prop=revisions&rvprop=size`;
			const response = await fetch.default(reqUrl, {
				method: "GET",
				headers: wikiApiHeader
			});
			if (response.ok) {
				const body = await response.textConverted();
				try {
					const parsed = JSON.parse(body);
					const pages = parsed?.query?.pages;
					for (const page in pages) {
						const revisions = pages[page].revisions;
						if (typeof revisions.length === "number" && revisions.length > 0) {
							const size = revisions[0].size;
							if (typeof size === "number") {
								return size;
							}
							return 0;
						}
						break;
					}
					return 0;
				} catch {
					return 0;
				}
			}
			return 0;
		}
		return 0;
	} catch {
		return 0;
	}
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
