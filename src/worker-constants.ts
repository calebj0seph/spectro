import { SpectrogramOptions } from './spectrogram';

export const ACTION_COMPUTE_SPECTROGRAM = 'spectrogram-compute';

interface MessageBase<T, U, V> {
    request: {
        action: T;
        payload: U;
    };
    response: {
        payload?: V;
        error?: Error;
    };
}

export type ComputeSpectrogramMessage = MessageBase<
    typeof ACTION_COMPUTE_SPECTROGRAM,
    {
        samplesBuffer: ArrayBufferLike;
        samplesStart: number;
        samplesLength: number;
        options: SpectrogramOptions;
    },
    {
        spectrogramWindowCount: number;
        spectrogramOptions: Required<SpectrogramOptions>;
        spectrogramBuffer: ArrayBufferLike;
        inputBuffer: ArrayBufferLike;
    }
>;

export type Message = ComputeSpectrogramMessage;
