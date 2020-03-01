declare module 'jsfft/complex_array' {
    type TypedArray =
        | Int8Array
        | Uint8Array
        | Int16Array
        | Uint16Array
        | Int32Array
        | Uint32Array
        | Uint8ClampedArray
        | Float32Array
        | Float64Array;

    export interface ComplexNumber {
        real: number;
        imag: number;
    }

    export default class ComplexArray<T extends TypedArray = Float32Array> {
        public readonly real: T;

        public readonly imag: T;

        public readonly length: number;

        constructor(
            other: ComplexArray<T> | Iterable<number>,
            arrayType?: { new (x: number | Iterable<number>): T }
        );

        toString(): string;

        forEach(iterator: (value: ComplexNumber, i: number, n: number) => void): void;

        map(mapper: (value: ComplexNumber, i: number, n: number) => void): ComplexArray<T>;

        conjugate(): ComplexArray<T>;

        magnitude(): T;
    }
}
