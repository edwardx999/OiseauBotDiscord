export { CircularBuffer }

class CircularBuffer<T>
{
	private data: T[];
	private full: boolean;
	private head: number;

	constructor(capacity: number, initial?: T[]) {
		this.data = Array.from({ length: capacity });
		if (initial === undefined) {
			this.full = false;
			this.head = 0;
		} else {
			if (initial.length > capacity) {
				for (let start = initial.length - capacity, i = 0; i < capacity; ++start, ++i) {
					this.data[i] = initial[i];
				}
				this.head = 0;
				this.full = true;
			}
			else {
				for (let i = 0; i < capacity; ++i) {
					this.data[i] = initial[i];
					this.head = initial.length;
					this.full = false;
				}
			}
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