import * as fetch from "node-fetch";

export { cppExec };

const cppExec = async (source: string) => {
	const reqBody = JSON.stringify({
		source: source,
		compiler: "g102",
		options: {
			userArguments: "-O2 -std=c++20",
			executeParameters: {
				args: ["prog"],
				stdin: ""
			},
			compilerOptions: {
				executorRequest: true
			},
			filters: {
				execute: true
			},
			tools: [],
			libraries: []
		},
		lang: "c++",
		allowStoreCodeDebug: true
	});
	const resp = await fetch.default("https://godbolt.org/api/compiler/g102/compile", {
		method: "POST",
		body: reqBody,
		headers: { "Content-Type": "application/json" }
	});
	if (!resp.ok) {
		throw resp.statusText;
	}
	const body = await resp.textConverted();
	return body;
};