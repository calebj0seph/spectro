declare module 'jsfft' {
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

    // eslint-disable-next-line import/no-unresolved
    import ComplexArrayBase, { ComplexNumber } from 'jsfft/complex_array';

    export function FFT<T extends TypedArray = Float32Array>(
        input: ComplexArray<T> | Iterable<number>
    ): ComplexArray<T>;
    export function InvFFT<T extends TypedArray = Float32Array>(
        input: ComplexArray<T> | Iterable<number>
    ): ComplexArray<T>;
    export function frequencyMap<T extends TypedArray = Float32Array>(
        input: ComplexArray<T> | Iterable<number>,
        filterer: (value: ComplexNumber, i: number, n: number) => void
    ): ComplexArray<T>;

    export class ComplexArray<T extends TypedArray> extends ComplexArrayBase<T> {
        FFT(): ComplexArray<T>;

        InvFFT(): ComplexArray<T>;

        frequencyMap(
            filterer: (value: ComplexNumber, i: number, n: number) => void
        ): ComplexArray<T>;
    }
}
