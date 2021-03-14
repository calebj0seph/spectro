import { clamp, lerp, inverseLerp } from './math-util';

export type Gradient = {
    stop: number;
    color: [number, number, number];
}[];

export const HEATED_METAL_GRADIENT: Gradient = [
    { stop: 0, color: [0, 0, 0] },
    { stop: 0.3, color: [128, 0, 128] },
    { stop: 0.65, color: [255, 0, 0] },
    { stop: 0.9, color: [255, 255, 0] },
    { stop: 1.0, color: [255, 255, 255] },
];

// Taken from:
// https://github.com/audacity/audacity/blob/0c44d0f7d31139ec6e9acb13ee246238a4863968/src/AllThemeResources.h#L361-L365
export const AUDACITY_GRADIENT: Gradient = [
    { stop: 0, color: [191, 191, 191] },
    { stop: 0.25, color: [76, 153, 255] },
    { stop: 0.5, color: [229, 25, 229] },
    { stop: 0.75, color: [255, 0, 0] },
    { stop: 1.0, color: [255, 255, 255] },
];

export const SPECTRUM_GRADIENT: Gradient = [
    { stop: 0, color: [0, 0, 128] },
    { stop: 0.25, color: [0, 160, 160] },
    { stop: 0.5, color: [0, 190, 0] },
    { stop: 0.75, color: [225, 225, 0] },
    { stop: 1.0, color: [255, 0, 0] },
];

export const BLACK_WHITE_GRADIENT: Gradient = [
    { stop: 0, color: [0, 0, 0] },
    { stop: 0.5, color: [119, 119, 119] },
    { stop: 1.0, color: [255, 255, 255] },
];

export const WHITE_BLACK_GRADIENT: Gradient = [
    { stop: 0, color: [255, 255, 255] },
    { stop: 0.5, color: [119, 119, 119] },
    { stop: 1.0, color: [0, 0, 0] },
];

export const GRADIENTS: { name: string; gradient: Gradient }[] = [
    {
        name: 'Heated Metal',
        gradient: HEATED_METAL_GRADIENT,
    },
    {
        name: 'Audacity®',
        gradient: AUDACITY_GRADIENT,
    },
    {
        name: 'Spectrum',
        gradient: SPECTRUM_GRADIENT,
    },
    {
        name: 'Black to White',
        gradient: BLACK_WHITE_GRADIENT,
    },
    {
        name: 'White to Black',
        gradient: WHITE_BLACK_GRADIENT,
    },
];

function addGamma(u: number): number {
    if (u <= 0.0031308) {
        return 12.92 * u;
    }
    return 1.055 * u ** (1 / 2.4) - 0.055;
}

function removeGamma(u: number): number {
    if (u <= 0.04045) {
        return u / 12.92;
    }
    return ((u + 0.055) / 1.055) ** 2.4;
}

function fLab(t: number): number {
    const x = 6 / 29;
    if (t > x ** 3) {
        return t ** (1 / 3);
    }
    return t / (3 * x * x) + 4 / 29;
}

function fLabInverse(t: number): number {
    const x = 6 / 29;
    if (t > x) {
        return t ** 3;
    }
    return 3 * x * x * (t - 4 / 29);
}

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
    const [lR, lG, lB] = [r, g, b].map((u) => removeGamma(u / 255));
    const [x, y, z] = [
        0.4124 * lR + 0.3576 * lG + 0.1805 * lB,
        0.2126 * lR + 0.7152 * lG + 0.0722 * lB,
        0.0193 * lR + 0.1192 * lG + 0.9505 * lB,
    ];
    return [
        116 * fLab(y / 100) - 16,
        500 * (fLab(x / 95.0489) - fLab(y / 100)),
        200 * (fLab(y / 100) - fLab(z / 108.884)),
    ];
}

export function labToRgb(l: number, a: number, b: number): [number, number, number] {
    const [x, y, z] = [
        95.0489 * fLabInverse((l + 16) / 116 + a / 500),
        100 * fLabInverse((l + 16) / 116),
        108.884 * fLabInverse((l + 16) / 116 - b / 200),
    ];
    const [lR, lG, lB] = [
        3.2406 * x - 1.5372 * y - 0.4986 * z,
        -0.9689 * x + 1.8758 * y + 0.0415 * z,
        0.0557 * x - 0.204 * y + 1.057 * z,
    ];
    return [lR, lG, lB].map((u) => Math.floor(clamp(256 * addGamma(u), 0, 255))) as [
        number,
        number,
        number
    ];
}

// Given a gradient and a position between 0.0 and 1.0, get the color on the gradient at that point
export function colorRamp(x: number, gradient: Gradient): [number, number, number] {
    let startIdx = 0;
    let endIdx = 0;
    for (let i = 0; i < gradient.length; i += 1) {
        if (gradient[i].stop >= clamp(x, 0, 1)) {
            endIdx = i;
            if (i > 0) {
                startIdx = i - 1;
            } else {
                startIdx = endIdx;
            }
            break;
        }
    }

    const t =
        startIdx === endIdx
            ? 0
            : inverseLerp(gradient[startIdx].stop, gradient[endIdx].stop, clamp(x, 0, 1));
    const start = rgbToLab(...gradient[startIdx].color);
    const end = rgbToLab(...gradient[endIdx].color);
    const ease = (u: number) => (u < 0.5 ? 2 * u * u : -1 + (4 - 2 * u) * u);
    return labToRgb(
        lerp(start[0], end[0], ease(t)),
        lerp(start[1], end[1], ease(t)),
        lerp(start[2], end[2], ease(t))
    );
}
