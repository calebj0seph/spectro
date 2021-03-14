import { SpectrogramOptions, SpectrogramResult } from './spectrogram';
import { ACTION_COMPUTE_SPECTROGRAM, ComputeSpectrogramMessage, Message } from './worker-constants';
// eslint-disable-next-line import/extensions
import HelperWorker from './workers/helper.worker.ts';

const WORKER_QUEUE: ((worker: HelperWorker) => void)[] = [];
const WORKER_POOL: { worker: HelperWorker; busy: boolean }[] = [];
for (let i = 0; i < (window.navigator.hardwareConcurrency || 4); i += 1) {
    WORKER_POOL.push({
        worker: new HelperWorker(),
        busy: false,
    });
}

function getFreeWorker(): Promise<HelperWorker> {
    const workerData = WORKER_POOL.find((w) => !w.busy);
    if (workerData !== undefined) {
        workerData.busy = true;
        return Promise.resolve(workerData.worker);
    }
    return new Promise((resolve) => {
        WORKER_QUEUE.push(resolve);
    });
}

function releaseWorker(worker: HelperWorker) {
    const workerData = WORKER_POOL.find((w) => w.worker === worker);
    if (workerData === undefined) {
        throw new Error('Provided worker to release is not valid');
    }

    workerData.busy = false;

    if (WORKER_QUEUE.length > 0) {
        const [next] = WORKER_QUEUE.splice(0, 1);
        workerData.busy = true;
        next(workerData.worker);
    }
}

function queueTask<T extends Message>(
    action: T['request']['action'],
    payload: T['request']['payload'],
    transfer: Transferable[]
): Promise<Required<T['response']>['payload']> {
    return new Promise((resolve, reject) => {
        getFreeWorker().then((worker) => {
            const messageHandler = (event: { data: T['response'] }) => {
                worker.removeEventListener('message', messageHandler);
                releaseWorker(worker);

                if ('error' in event.data) {
                    reject(event.data.error);
                    return;
                }
                resolve(event.data.payload);
            };

            worker.addEventListener('message', messageHandler);

            worker.postMessage(
                {
                    action,
                    payload,
                },
                transfer
            );
        });
    });
}

export function getWorkerCount(): number {
    return WORKER_POOL.length;
}

export async function offThreadGenerateSpectrogram(
    samples: Float32Array,
    samplesStart: number,
    samplesLength: number,
    options: SpectrogramOptions
): Promise<SpectrogramResult & { input: Float32Array }> {
    const {
        spectrogramWindowCount,
        spectrogramOptions,
        spectrogramBuffer,
        inputBuffer,
    } = await queueTask<ComputeSpectrogramMessage>(
        ACTION_COMPUTE_SPECTROGRAM,
        {
            samplesBuffer: samples.buffer,
            samplesStart,
            samplesLength,
            options,
        },
        [samples.buffer]
    );

    return {
        windowCount: spectrogramWindowCount,
        options: spectrogramOptions,
        spectrogram: new Float32Array(spectrogramBuffer),
        input: new Float32Array(inputBuffer),
    };
}
