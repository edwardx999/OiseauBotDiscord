export { CircularBuffer }

class CircularBuffer<T>
{
	private data: (T | undefined)[];
	private head: number;

	constructor(capacity: number) {
		this.data = Array(capacity).fill(undefined);
		this.head = 0;
	}

	last(offset?: number) {
		offset = offset || 0;
		if (offset >= this.data.length) {
			return undefined;
		}
		const index = this.head - offset - 1;
		if (index >= 0) {
			return this.data[index];
		}
		return this.data[index + this.data.length];
	}

	push(what: T) {
		this.data[this.head] = what;
		++this.head;
		if (this.head >= this.data.length) {
			this.head = 0;
		}
		return what;
	}
}