export { CircularBuffer }

class CircularBuffer<T>
{
	private data: T[];
	private full: boolean;
	private head: number;

	constructor(capacity: number, initial?: T[]) {
		if (initial === undefined) {
			this.data = Array.from({ length: capacity });
			this.full = false;
			this.head = 0;
		}
		else if (initial.length >= capacity) {
			this.data = initial.slice(initial.length - capacity);
			this.head = 0;
			this.full = true;
		}
		else {
			this.data = Array.from({ length: capacity });
			for (let i = 0; i < initial.length; ++i) {
				this.data[i] = initial[i];
			}
			this.head = initial.length;
			this.full = false;
		}
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
			this.full = true;
		}
		return what;
	}

	capacity() {
		return this.data.length;
	}

	size() {
		if (this.full) {
			return this.data.length;
		}
		return this.head;
	}

	toArray(prealloced?: T[]) {
		if (prealloced === undefined) {
			prealloced = Array.from({ length: this.size() });
		}
		this.placeInArray(prealloced);
		return prealloced;
	}

	placeInArray(arr: T[]) {
		if (this.full) {
			let j = 0;
			arr.length = this.data.length;
			for (let i = this.head; i < this.data.length; ++i) {
				arr[j] = this.data[i];
				++j;
			}
			for (let i = 0; i < this.head; ++i) {
				arr[j] = this.data[i];
				++j;
			}
		}
		else {
			arr.length = this.head;
			for (let i = 0; i < this.head; ++i) {
				arr[i] = this.data[i];
			}
		}
	}
}