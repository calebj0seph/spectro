import debounce from 'lodash.debounce';

import initialiseControlsUi from './controls-ui';
import { Circular2DBuffer } from './math-util';
import { SpectrogramGPURenderer, RenderParameters } from './spectrogram-render';
import { offThreadGenerateSpectrogram } from './worker-util';

const SPECTROGRAM_WINDOW_SIZE = 4096;
const SPECTROGRAM_WINDOW_OVERLAP = 1024;

interface SpectrogramBufferData {
    buffer: Float32Array;
    start: number;
    length: number;
    sampleRate: number;
    isStart: boolean;
}

// Starts rendering the spectrograms, returning callbacks used to provide audio samples to render
// and update the display parameters of the spectrograms
async function startRenderingSpectrogram(): Promise<{
    bufferCallback: (bufferData: SpectrogramBufferData[]) => Promise<Float32Array[]>;
    clearCallback: () => void;
    updateRenderParameters: (parameters: Partial<RenderParameters>) => void;
}> {
    // The canvases that will render the spectrogram for each audio channel
    const spectrogramCanvases = [
        document.querySelector('#leftSpectrogram') as HTMLCanvasElement | null,
        document.querySelector('#rightSpectrogram') as HTMLCanvasElement | null,
    ];

    // The callbacks for each spectrogram that will render the audio samples provided when called
    const bufferCallbacks: ((bufferData: SpectrogramBufferData) => Promise<Float32Array>)[] = [];

    // Set up the WebGL contexts for each spectrogram
    const spectrogramBuffers: Circular2DBuffer<Float32Array>[] = [];
    const renderers: SpectrogramGPURenderer[] = [];
    spectrogramCanvases.forEach((canvas) => {
        if (canvas === null || canvas.parentElement === null) {
            return;
        }

        // The 2D circular queue of the FFT data for each audio channel
        const spectrogramBuffer = new Circular2DBuffer(
            Float32Array,
            canvas.parentElement.offsetWidth,
            SPECTROGRAM_WINDOW_SIZE / 2,
            1
        );
        spectrogramBuffers.push(spectrogramBuffer);

        const renderer = new SpectrogramGPURenderer(
            canvas,
            spectrogramBuffer.width,
            spectrogramBuffer.height
        );
        renderer.resizeCanvas(canvas.parentElement.offsetWidth, canvas.parentElement.offsetHeight);
        renderers.push(renderer);

        let imageDirty = false;
        bufferCallbacks.push(
            async ({ buffer, start, length, sampleRate, isStart }: SpectrogramBufferData) => {
                renderer.updateParameters({
                    windowSize: SPECTROGRAM_WINDOW_SIZE,
                    sampleRate,
                });

                const spectrogram = await offThreadGenerateSpectrogram(buffer, start, length, {
                    windowSize: SPECTROGRAM_WINDOW_SIZE,
                    windowStepSize: SPECTROGRAM_WINDOW_OVERLAP,
                    sampleRate,
                    isStart,
                });
                spectrogramBuffer.enqueue(spectrogram.spectrogram);
                imageDirty = true;

                return spectrogram.input;
            }
        );

        // Trigger a render on each frame only if we have new spectrogram data to display
        const render = () => {
            if (imageDirty) {
                renderer.updateSpectrogram(spectrogramBuffer);
            }
            renderer.render();
            requestAnimationFrame(render);
        };
        requestAnimationFrame(render);
    });

    // Handle resizing of the window
    const resizeHandler = debounce(() => {
        spectrogramCanvases.forEach((canvas, i) => {
            if (canvas === null || canvas.parentElement === null) {
                return;
            }

            spectrogramBuffers[i].resizeWidth(canvas.parentElement.offsetWidth);
            renderers[i].resizeCanvas(
                canvas.parentElement.offsetWidth,
                canvas.parentElement.offsetHeight
            );
            renderers[i].updateSpectrogram(spectrogramBuffers[i]);
        });
    }, 250);
    window.addEventListener('resize', resizeHandler);

    // Make sure the canvas still displays properly in the middle of a resize
    window.addEventListener('resize', () => {
        spectrogramCanvases.forEach((canvas, i) => {
            if (canvas === null || canvas.parentElement === null) {
                return;
            }

            renderers[i].fastResizeCanvas(
                canvas.parentElement.offsetWidth,
                canvas.parentElement.offsetHeight
            );
        });
    });

    return {
        bufferCallback: (buffers: SpectrogramBufferData[]) =>
            Promise.all(buffers.map((buffer, i) => bufferCallbacks[i](buffer))),
        clearCallback: () => {
            renderers.forEach((renderer, i) => {
                spectrogramBuffers[i].clear();
                renderer.updateSpectrogram(spectrogramBuffers[i], true);
            });
        },
        updateRenderParameters: (parameters: Partial<RenderParameters>) => {
            for (let i = 0; i < renderers.length; i += 1) {
                renderers[i].updateParameters(parameters);
            }
        },
    };
}

async function setupSpectrogramFromMicrophone(
    audioCtx: AudioContext,
    bufferCallback: (bufferData: SpectrogramBufferData[]) => Promise<Float32Array[]>
) {
    const CHANNELS = 2;
    const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const source = audioCtx.createMediaStreamSource(mediaStream);

    const processor = audioCtx.createScriptProcessor(
        SPECTROGRAM_WINDOW_OVERLAP,
        CHANNELS,
        CHANNELS
    );

    // An array of the last received audio buffers for each channel
    const channelBuffers: Float32Array[][] = [];
    for (let i = 0; i < CHANNELS; i += 1) {
        channelBuffers.push([]);
    }

    let sampleRate: number | null = null;
    let isStart = true;
    let bufferCallbackPromise: Promise<Float32Array[]> | null = null;
    const processChannelBuffers = () => {
        if (bufferCallbackPromise !== null) {
            return;
        }

        const buffers: Float32Array[] = [];
        for (let i = 0; i < CHANNELS; i += 1) {
            // Check if we have at least full window to render yet
            if (channelBuffers[i].length < SPECTROGRAM_WINDOW_SIZE / SPECTROGRAM_WINDOW_OVERLAP) {
                break;
            }

            // Merge all the buffers we have so far into a single buffer for rendering
            const buffer = new Float32Array(channelBuffers[i].length * SPECTROGRAM_WINDOW_OVERLAP);
            buffers.push(buffer);
            for (let j = 0; j < channelBuffers[i].length; j += 1) {
                buffer.set(channelBuffers[i][j], SPECTROGRAM_WINDOW_OVERLAP * j);
            }

            // Delete the oldest buffers that aren't needed any more for the next render
            channelBuffers[i].splice(
                0,
                channelBuffers[i].length - SPECTROGRAM_WINDOW_SIZE / SPECTROGRAM_WINDOW_OVERLAP + 1
            );
        }

        // Render the single merged buffer for each channel
        if (buffers.length > 0) {
            bufferCallbackPromise = bufferCallback(
                buffers.map((buffer) => ({
                    buffer,
                    start: 0,
                    length: buffer.length,
                    sampleRate: sampleRate!,
                    isStart,
                }))
            );
            bufferCallbackPromise.then(() => {
                bufferCallbackPromise = null;
            });
            isStart = false;
        }
    };

    // Each time we record an audio buffer, save it and then render the next window when we have
    // enough samples
    processor.addEventListener('audioprocess', (e) => {
        for (let i = 0; i < Math.min(CHANNELS, e.inputBuffer.numberOfChannels); i += 1) {
            const channelBuffer = e.inputBuffer.getChannelData(i);
            channelBuffers[i].push(new Float32Array(channelBuffer));
        }
        // If a single channel input, pass an empty signal for the right channel
        for (let i = Math.min(CHANNELS, e.inputBuffer.numberOfChannels); i < CHANNELS; i += 1) {
            channelBuffers[i].push(new Float32Array(SPECTROGRAM_WINDOW_OVERLAP));
        }
        sampleRate = e.inputBuffer.sampleRate;
        processChannelBuffers();
    });

    source.connect(processor);
    processor.connect(audioCtx.destination);

    // Return a function to stop rendering
    return () => {
        processor.disconnect(audioCtx.destination);
        source.disconnect(processor);
    };
}

async function setupSpectrogramFromAudioFile(
    audioCtx: AudioContext,
    arrayBuffer: ArrayBuffer,
    bufferCallback: (bufferData: SpectrogramBufferData[]) => Promise<Float32Array[]>,
    audioEndCallback: () => void
) {
    const audioBuffer = await new Promise<AudioBuffer>((resolve, reject) =>
        audioCtx.decodeAudioData(
            arrayBuffer,
            (buffer) => resolve(buffer),
            (err) => reject(err)
        )
    );

    let channelData: Float32Array[] = [];
    for (let i = 0; i < audioBuffer.numberOfChannels; i += 1) {
        channelData.push(new Float32Array(audioBuffer.getChannelData(i)));
    }

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);
    let isStopping = false;
    const playStartTime = performance.now();
    let nextSample = 0;

    const audioEventCallback = async () => {
        const duration = (performance.now() - playStartTime) / 1000;
        const bufferCallbackData = [];

        // Calculate spectrogram up to current point
        const totalSamples =
            Math.ceil((duration * audioBuffer.sampleRate - nextSample) / SPECTROGRAM_WINDOW_SIZE) *
            SPECTROGRAM_WINDOW_SIZE;

        if (totalSamples > 0) {
            for (let i = 0; i < audioBuffer.numberOfChannels; i += 1) {
                bufferCallbackData.push({
                    buffer: channelData[i],
                    start: nextSample,
                    length: totalSamples,
                    sampleRate: audioBuffer.sampleRate,
                    isStart: nextSample === 0,
                });
            }

            nextSample =
                nextSample + totalSamples - SPECTROGRAM_WINDOW_SIZE + SPECTROGRAM_WINDOW_OVERLAP;
            channelData = await bufferCallback(bufferCallbackData);
        }

        if (!isStopping && duration / audioBuffer.duration < 1.0) {
            setTimeout(
                audioEventCallback,
                ((SPECTROGRAM_WINDOW_OVERLAP / audioBuffer.sampleRate) * 1000) / 2
            );
        } else {
            source.disconnect(audioCtx.destination);
            audioEndCallback();
        }
    };
    audioEventCallback();

    // Play audio
    audioCtx.resume();
    source.start(0);

    // Return a function to stop rendering
    return () => {
        isStopping = true;
        source.disconnect(audioCtx.destination);
    };
}

const spectrogramCallbacksPromise = startRenderingSpectrogram();
let globalAudioCtx: AudioContext | null = null;

(async () => {
    const controlsContainer = document.querySelector('.controls');
    const {
        bufferCallback,
        clearCallback,
        updateRenderParameters,
    } = await spectrogramCallbacksPromise;
    if (controlsContainer !== null) {
        let stopCallback: (() => void) | null = null;
        const setPlayState = initialiseControlsUi(controlsContainer, {
            stopCallback: () => {
                if (stopCallback !== null) {
                    stopCallback();
                }
                stopCallback = null;
            },
            clearSpectrogramCallback: () => {
                clearCallback();
            },
            renderParametersUpdateCallback: (parameters: Partial<RenderParameters>) => {
                updateRenderParameters(parameters);
            },
            renderFromMicrophoneCallback: () => {
                if (globalAudioCtx === null) {
                    globalAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
                }
                setupSpectrogramFromMicrophone(globalAudioCtx, bufferCallback).then(
                    (callback) => {
                        stopCallback = callback;
                        setPlayState('playing');
                    },
                    () => setPlayState('stopped')
                );
            },
            renderFromFileCallback: (file: ArrayBuffer) => {
                if (globalAudioCtx === null) {
                    globalAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
                }
                setupSpectrogramFromAudioFile(globalAudioCtx, file, bufferCallback, () =>
                    setPlayState('stopped')
                ).then(
                    (callback) => {
                        stopCallback = callback;
                        setPlayState('playing');
                    },
                    () => setPlayState('stopped')
                );
            },
        });
    }
})();
