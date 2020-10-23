import * as WC from "../wiki_composer";
import { getComposer, Difficulty } from "../message_handler";
import * as math from "mathjs"

function getStats(nums: number[]) {
	nums.sort((a, b) => (a - b));
	return {
		max: nums[nums.length - 1],
		median: nums[nums.length / 2],
		min: nums[0],
		average: math.mean(nums) as number,
		stdev: math.std(nums)
	};
}



(async () => {
	const data = await WC.fetchComposerList();
	const sample = async (difficulty: Difficulty) => {
		const pageSizes: number[] = [];
		for (let i = 0; i < 30; ++i) {
			pageSizes.push((await getComposer(data, difficulty)).pageSize);
		}
		const stats = getStats(pageSizes);
		return { pageSizes, stats };
	};

	console.log(await sample("hardest"));
	console.log(await sample("hard"));
	console.log(await sample("medium"));
	console.log(await sample("easy"));
	console.log(await sample("easiest"));
	let x = 0;
}) ();
