import { FFT } from 'jsfft';

import { blackmanHarris, hzToMel, inverseLerp, lerp, melToHz } from './math-util';

export type Scale = 'linear' | 'mel';

export interface SpectrogramOptions {
    isStart?: boolean;
    isEnd?: boolean;
    windowSize?: number;
    windowStepSize?: number;
    minFrequencyHz?: number;
    maxFrequencyHz?: number;
    sampleRate: number;
    scale?: Scale;
    scaleSize?: number;
}

export interface SpectrogramResult {
    windowCount: number;
    options: Required<SpectrogramOptions>;
    spectrogram: Float32Array;
}

function generateSpectrogramForSingleFrame(
    windowSamples: Float32Array,
    resultBuffer: Float32Array,
    resultBufferIndex: number,
    minFrequencyHz: number,
    maxFrequencyHz: number,
    sampleRate: number,
    scale: Scale,
    scaleSize: number
) {
    // Apply a Blackman-Harris windowing function to the input
    for (let i = 0; i < windowSamples.length; i += 1) {
        windowSamples[i] *= blackmanHarris(i, windowSamples.length);
    }

    const fft = FFT(windowSamples);
    for (let j = 0; j < scaleSize; j += 1) {
        const scaleAmount = inverseLerp(0, scaleSize - 1, j);
        let n;
        switch (scale) {
            case 'linear': {
                const hz = lerp(minFrequencyHz, maxFrequencyHz, scaleAmount);
                n = (hz * windowSamples.length) / sampleRate;
                break;
            }
            case 'mel': {
                const mel = lerp(hzToMel(minFrequencyHz), hzToMel(maxFrequencyHz), scaleAmount);
                n = (melToHz(mel) * windowSamples.length) / sampleRate;
                break;
            }
            default:
                throw new Error('Unknown scale');
        }

        const lowerN = Math.floor(n);
        const upperN = Math.ceil(n);

        const amplitude =
            lerp(
                Math.sqrt(fft.real[lowerN] ** 2 + fft.imag[lowerN] ** 2),
                Math.sqrt(fft.real[upperN] ** 2 + fft.imag[upperN] ** 2),
                n - lowerN
            ) / Math.sqrt(windowSamples.length);

        resultBuffer[resultBufferIndex + j] = amplitude;
    }
}

export function generateSpectrogram(
    samples: Float32Array,
    samplesStart: number,
    samplesLength: number,
    {
        isStart = false, // Is the frame at the start of the audio
        isEnd = false, // Is the frame at the end of the audio
        windowSize = 4096, // Size of the FFT window in samples
        windowStepSize = 1024, // Number of samples between each FFT window
        minFrequencyHz, // Smallest frequency in Hz to calculate the spectrogram for
        maxFrequencyHz, // Largest frequency in Hz to calculate the spectrogram for
        sampleRate, // Sample rate of the audio
        scale = 'linear', // Scale of the returned spectrogram (can be 'linear' or 'mel')
        scaleSize, // Number of rows in the returned spectrogram
    }: SpectrogramOptions
): SpectrogramResult {
    if (minFrequencyHz === undefined) {
        minFrequencyHz = 0;
    }
    if (maxFrequencyHz === undefined) {
        maxFrequencyHz = (sampleRate * (windowSize - 2)) / (2 * windowSize);
    }
    if (scaleSize === undefined) {
        scaleSize = windowSize / 2;
    }
    if (windowSize % windowStepSize !== 0) {
        throw new Error('Window step size must be evenly divisible by the window size');
    }

    let numWindows =
        Math.ceil(samplesLength / windowStepSize) - Math.floor(windowSize / windowStepSize) + 1;
    let startIdx = samplesStart;
    if (isStart || isEnd) {
        const additionalWindows = Math.floor(windowSize / windowStepSize) - 1;
        if (isStart) {
            numWindows += additionalWindows;
            startIdx -= additionalWindows * windowStepSize;
        }
        if (isEnd) {
            numWindows += additionalWindows;
        }
    }

    const result = new Float32Array(scaleSize * numWindows);
    const windowSamples = new Float32Array(windowSize);

    for (
        let i = startIdx, windowIdx = 0;
        windowIdx < numWindows * scaleSize;
        i += windowStepSize, windowIdx += scaleSize
    ) {
        for (let j = 0; j < windowSize; j += 1) {
            const sampleIdx = i + j;
            if (sampleIdx < samplesStart || sampleIdx >= samplesStart + samplesLength) {
                windowSamples[j] = 0;
            } else {
                windowSamples[j] = samples[sampleIdx];
            }
        }

        generateSpectrogramForSingleFrame(
            windowSamples,
            result,
            windowIdx,
            minFrequencyHz,
            maxFrequencyHz,
            sampleRate,
            scale,
            scaleSize
        );
    }

    return {
        windowCount: numWindows,
        options: {
            isStart,
            isEnd,
            windowSize,
            windowStepSize,
            minFrequencyHz,
            maxFrequencyHz,
            sampleRate,
            scale,
            scaleSize,
        },
        spectrogram: result,
    };
}
