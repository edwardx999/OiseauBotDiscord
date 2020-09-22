import * as fetch from "node-fetch";
import * as xml from "xml2js"
export { fetchComposerList, ComposerData, fetchComposerPageSize }
interface ComposerData {
	name: string;
	dates?: string;
	pageUrl?: string;
	pageSize?: number;
}

let composerList: ComposerData[] | undefined;

let currentFetchRequest: Promise<fetch.Response> | undefined;
let currentListPromise: Promise<ComposerData[]> | undefined;

function getDatesString(str: string) {
	const lastParen = str.lastIndexOf(")");
	if (lastParen < 0) {
		return "";
	}
	const firstParen = str.lastIndexOf("(");
	if (firstParen >= 0 && firstParen < lastParen) {
		return str.substring(firstParen + 1, lastParen);
	}
	return "";
}

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
				headers: {
					"User-Agent": "Oiseaubot (https://github.com/edwardx999)"
				}
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

async function fetchComposerList() {
	if (composerList) {
		return composerList;
	}
	if (currentListPromise) {
		return await currentListPromise;
	}
	if (!currentFetchRequest) {
		currentFetchRequest = fetch.default("https://en.wikipedia.org/wiki/List_of_composers_by_name");
	}
	const wikipediaData = await currentFetchRequest;
	currentFetchRequest = undefined;
	if (currentListPromise) {
		await currentListPromise;
	}
	else {
		currentListPromise = new Promise(async (resolve, reject) => {
			if (wikipediaData.ok) {
				const body = await wikipediaData.textConverted();
				if (composerList) {
					return composerList;
				}
				const startTag = `<div class="div-col columns column-width`;
				const endTag = `</div>`;
				const tempComposerList: ComposerData[] = [];
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
									if (title && href) {
										if ((title as string).indexOf("page does not exist") >= 0) {
											tempComposerList.push({ name: name, dates: content && getDatesString(content) })
										}
										else {
											tempComposerList.push({ name: name, dates: content && getDatesString(content), pageUrl: href })
										}
									}
								}
							}
						}
					}
				}
				composerList = tempComposerList;
				currentListPromise = undefined;
				resolve(composerList);
			}
			else {
				resolve();
			}
		});
		return await currentListPromise;
	}

}
