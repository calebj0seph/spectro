import { colorRamp, Gradient, HEATED_METAL_GRADIENT } from './color-util';
import { Circular2DBuffer, lerp } from './math-util';
import FragmentShader from './shaders/fragment.glsl';
import VertexShader from './shaders/vertex.glsl';
import { Scale } from './spectrogram';

export interface RenderParameters {
    contrast: number;
    sensitivity: number;
    zoom: number;
    minFrequencyHz: number;
    maxFrequencyHz: number;
    sampleRate: number;
    windowSize: number;
    scale: Scale;
    gradient: Gradient;
}

function merge<T>(
    newValue: T | undefined | null,
    oldValue: T | undefined | null,
    defaultValue: T
): T {
    if (newValue !== undefined && newValue !== null) {
        return newValue;
    }
    if (oldValue !== undefined && oldValue !== null) {
        return oldValue;
    }
    return defaultValue;
}

function stepTowards(x: number, y: number, amount: number): number {
    if (Math.abs(x - y) < 1e-9) {
        return y;
    }
    return lerp(x, y, amount);
}

export class SpectrogramGPURenderer {
    private readonly canvas: HTMLCanvasElement;

    private readonly ctx: WebGLRenderingContext;

    private readonly vertexBuffer: WebGLBuffer;

    private readonly indexBuffer: WebGLBuffer;

    private spectrogramTexture: WebGLTexture;

    private scaleTexture: WebGLTexture | null = null;

    private gradientTexture: WebGLTexture | null = null;

    private spectrogramWidth: number;

    private spectrogramHeight: number;

    private spectrogramLength: number = 0;

    private spectrogramOffset: number = 0;

    private lastSpectrogramStart: number | null = null;

    private lastSpectrogramLength: number = 0;

    private parameters: RenderParameters | null = null;

    private scaleRange: [number, number] = [0, 0];

    private currentScaleRange: [number, number] = [0, 0];

    private currentContrast: number = 25;

    private currentSensitivity: number = 25;

    private currentZoom: number = 4;

    private resizeHandlerLastRealWidth: number = 0;

    private resizeHandlerZoomOverride: number = 1;

    private readonly program: {
        program: WebGLProgram;
        positionAttribute: number;
        texCoordAttribute: number;
        spectrogramSamplerUniform: WebGLUniformLocation;
        scaleSamplerUniform: WebGLUniformLocation;
        gradientSamplerUniform: WebGLUniformLocation;
        spectrogramOffsetUniform: WebGLUniformLocation;
        spectrogramLengthUniform: WebGLUniformLocation;
        scaleRangeUniform: WebGLUniformLocation;
        contrastUniform: WebGLUniformLocation;
        sensitivityUniform: WebGLUniformLocation;
        zoomUniform: WebGLUniformLocation;
    };

    constructor(canvas: HTMLCanvasElement, spectrogramWidth: number, spectrogramHeight: number) {
        this.canvas = canvas;
        const ctx = this.canvas.getContext('webgl');

        if (ctx === null) {
            throw new Error('Unable to create WebGL context');
        }
        this.ctx = ctx;

        if (this.ctx.getExtension('OES_texture_float') === null) {
            throw new Error('OES_texture_float extension is not supported');
        }

        if (this.ctx.getExtension('OES_texture_float_linear') === null) {
            throw new Error('OES_texture_float_linear extension is not supported');
        }

        const program = this.loadProgram(VertexShader.sourceCode, FragmentShader.sourceCode);
        this.program = {
            program,
            positionAttribute: this.ctx.getAttribLocation(program, 'aVertexPos'),
            texCoordAttribute: this.ctx.getAttribLocation(program, 'aVertexTexCoord'),
            spectrogramSamplerUniform: this.getUniformLocation(
                program,
                FragmentShader.uniforms.uSpectrogramSampler.variableName
            ),
            scaleSamplerUniform: this.getUniformLocation(
                program,
                FragmentShader.uniforms.uScaleSampler.variableName
            ),
            gradientSamplerUniform: this.getUniformLocation(
                program,
                FragmentShader.uniforms.uGradientSampler.variableName
            ),
            spectrogramOffsetUniform: this.getUniformLocation(
                program,
                FragmentShader.uniforms.uSpectrogramOffset.variableName
            ),
            spectrogramLengthUniform: this.getUniformLocation(
                program,
                FragmentShader.uniforms.uSpectrogramLength.variableName
            ),
            scaleRangeUniform: this.getUniformLocation(
                program,
                FragmentShader.uniforms.uScaleRange.variableName
            ),
            contrastUniform: this.getUniformLocation(
                program,
                FragmentShader.uniforms.uContrast.variableName
            ),
            sensitivityUniform: this.getUniformLocation(
                program,
                FragmentShader.uniforms.uSensitivity.variableName
            ),
            zoomUniform: this.getUniformLocation(
                program,
                FragmentShader.uniforms.uZoom.variableName
            ),
        };

        const [vertexBuffer, indexBuffer] = this.createFullscreenQuad();
        this.vertexBuffer = vertexBuffer;
        this.indexBuffer = indexBuffer;

        this.ctx.pixelStorei(this.ctx.UNPACK_ALIGNMENT, 1);

        this.spectrogramWidth = spectrogramWidth;
        this.spectrogramHeight = spectrogramHeight;
        // Store the spectrogram in the reverse orientation for faster updates
        this.spectrogramTexture = this.createSpectrogramTexture(
            spectrogramHeight,
            spectrogramWidth
        );

        this.updateParameters({});
    }

    render() {
        this.ctx.clearColor(0.0, 0.0, 0.0, 1.0);
        this.ctx.clear(this.ctx.COLOR_BUFFER_BIT);

        this.ctx.bindBuffer(this.ctx.ARRAY_BUFFER, this.vertexBuffer);
        this.ctx.bindBuffer(this.ctx.ELEMENT_ARRAY_BUFFER, this.indexBuffer);

        this.ctx.vertexAttribPointer(
            this.program.positionAttribute,
            2,
            this.ctx.FLOAT,
            false,
            16,
            0
        );
        this.ctx.enableVertexAttribArray(this.program.positionAttribute);
        this.ctx.vertexAttribPointer(
            this.program.texCoordAttribute,
            2,
            this.ctx.FLOAT,
            false,
            16,
            8
        );
        this.ctx.enableVertexAttribArray(this.program.texCoordAttribute);

        this.ctx.useProgram(this.program.program);
        this.ctx.uniform1f(this.program.spectrogramOffsetUniform, this.spectrogramOffset);
        this.ctx.uniform1f(this.program.spectrogramLengthUniform, this.spectrogramLength);

        // Smoothing factor to make render parameter changes gradually interpolate to their new
        // value
        const LERP_AMOUNT = 0.5;
        this.currentScaleRange = [
            stepTowards(this.currentScaleRange[0], this.scaleRange[0], LERP_AMOUNT),
            stepTowards(this.currentScaleRange[1], this.scaleRange[1], LERP_AMOUNT),
        ];
        this.currentContrast = stepTowards(
            this.currentContrast,
            this.parameters!.contrast,
            LERP_AMOUNT
        );
        // Don't interpolate the contrast when it gets close toe 0 to avoid numerical instability in
        // the shader
        if (this.currentContrast < 0.05) {
            this.currentContrast = 0.0;
        }
        this.currentSensitivity = stepTowards(
            this.currentSensitivity,
            this.parameters!.sensitivity,
            LERP_AMOUNT
        );
        this.currentZoom = stepTowards(this.currentZoom, this.parameters!.zoom, LERP_AMOUNT);
        this.ctx.uniform2fv(this.program.scaleRangeUniform, this.currentScaleRange);
        this.ctx.uniform1f(this.program.contrastUniform, this.currentContrast);
        this.ctx.uniform1f(this.program.sensitivityUniform, this.currentSensitivity);
        this.ctx.uniform1f(
            this.program.zoomUniform,
            this.resizeHandlerZoomOverride * this.currentZoom
        );

        this.ctx.activeTexture(this.ctx.TEXTURE0);
        this.ctx.bindTexture(this.ctx.TEXTURE_2D, this.spectrogramTexture);
        this.ctx.uniform1i(this.program.spectrogramSamplerUniform, 0);

        this.ctx.activeTexture(this.ctx.TEXTURE1);
        this.ctx.bindTexture(this.ctx.TEXTURE_2D, this.scaleTexture);
        this.ctx.uniform1i(this.program.scaleSamplerUniform, 1);

        this.ctx.activeTexture(this.ctx.TEXTURE2);
        this.ctx.bindTexture(this.ctx.TEXTURE_2D, this.gradientTexture);
        this.ctx.uniform1i(this.program.gradientSamplerUniform, 2);

        this.ctx.drawElements(this.ctx.TRIANGLES, 6, this.ctx.UNSIGNED_SHORT, 0);
    }

    public resizeCanvas(width: number, height: number) {
        this.lastSpectrogramStart = null;
        this.resizeHandlerZoomOverride = 1;
        this.resizeHandlerLastRealWidth = width;
        this.canvas.width = width;
        this.canvas.height = height;
        this.ctx.viewport(0, 0, width, height);
    }

    public fastResizeCanvas(width: number, height: number) {
        this.resizeHandlerZoomOverride = this.resizeHandlerLastRealWidth / width;
        this.canvas.width = width;
        this.canvas.height = height;
        this.ctx.viewport(0, 0, width, height);
    }

    public updateParameters(parameters: Partial<RenderParameters>) {
        const newParameters: RenderParameters = {
            contrast: merge(parameters.contrast, this.parameters?.contrast, 25),
            sensitivity: merge(parameters.sensitivity, this.parameters?.sensitivity, 25),
            zoom: merge(parameters.zoom, this.parameters?.zoom, 4),
            minFrequencyHz: merge(parameters.minFrequencyHz, this.parameters?.minFrequencyHz, 10),
            maxFrequencyHz: merge(
                parameters.maxFrequencyHz,
                this.parameters?.maxFrequencyHz,
                12000
            ),
            sampleRate: merge(parameters.sampleRate, this.parameters?.sampleRate, 48000),
            windowSize: merge(parameters.windowSize, this.parameters?.windowSize, 4096),
            scale: merge(parameters.scale, this.parameters?.scale, 'mel'),
            gradient: merge(parameters.gradient, this.parameters?.gradient, HEATED_METAL_GRADIENT),
        };

        if (this.parameters === null || this.parameters.gradient !== newParameters.gradient) {
            this.updateGradientTexture(newParameters.gradient);
        }

        if (
            this.parameters === null ||
            this.parameters.scale !== newParameters.scale ||
            this.parameters.minFrequencyHz !== newParameters.minFrequencyHz ||
            this.parameters.maxFrequencyHz !== newParameters.maxFrequencyHz ||
            this.parameters.sampleRate !== newParameters.sampleRate ||
            this.parameters.windowSize !== newParameters.windowSize
        ) {
            this.updateScaleRange(
                newParameters.scale,
                newParameters.minFrequencyHz,
                newParameters.maxFrequencyHz,
                newParameters.sampleRate,
                newParameters.windowSize
            );
        }

        if (
            this.parameters === null ||
            this.parameters.scale !== newParameters.scale ||
            this.parameters.sampleRate !== newParameters.sampleRate ||
            this.parameters.windowSize !== newParameters.windowSize
        ) {
            this.updateScaleTexture(
                newParameters.scale,
                newParameters.sampleRate,
                newParameters.windowSize
            );
            this.currentScaleRange = this.scaleRange;
        }

        this.parameters = newParameters;
    }

    public updateSpectrogram(
        circular2dQueue: Circular2DBuffer<Float32Array>,
        forceFullRender: boolean = false
    ) {
        this.ctx.bindTexture(this.ctx.TEXTURE_2D, this.spectrogramTexture);

        if (forceFullRender || this.lastSpectrogramStart === null) {
            this.ctx.texImage2D(
                this.ctx.TEXTURE_2D,
                0,
                this.ctx.LUMINANCE,
                circular2dQueue.height,
                circular2dQueue.width,
                0,
                this.ctx.LUMINANCE,
                this.ctx.FLOAT,
                circular2dQueue.data
            );
        } else if (circular2dQueue.start !== this.lastSpectrogramStart) {
            if (circular2dQueue.start >= this.lastSpectrogramStart) {
                this.updateSpectrogramPartial(
                    circular2dQueue.height,
                    circular2dQueue.start - this.lastSpectrogramStart,
                    this.lastSpectrogramStart,
                    circular2dQueue.data
                );
            } else {
                this.updateSpectrogramPartial(
                    circular2dQueue.height,
                    circular2dQueue.start,
                    0,
                    circular2dQueue.data
                );
                this.updateSpectrogramPartial(
                    circular2dQueue.height,
                    circular2dQueue.width - this.lastSpectrogramStart,
                    this.lastSpectrogramStart,
                    circular2dQueue.data
                );
            }
        } else if (circular2dQueue.length > this.lastSpectrogramLength) {
            this.updateSpectrogramPartial(
                circular2dQueue.height,
                circular2dQueue.length - this.lastSpectrogramLength,
                this.lastSpectrogramLength,
                circular2dQueue.data
            );
        }

        this.lastSpectrogramLength = circular2dQueue.length;
        this.lastSpectrogramStart = circular2dQueue.start;
        this.spectrogramOffset = circular2dQueue.start / circular2dQueue.width;
        this.spectrogramLength =
            -0.5 / circular2dQueue.width + circular2dQueue.length / circular2dQueue.width;
    }

    private updateSpectrogramPartial(
        width: number,
        height: number,
        dataStart: number,
        data: Float32Array
    ) {
        this.ctx.texSubImage2D(
            this.ctx.TEXTURE_2D,
            0,
            0,
            dataStart,
            width,
            height,
            this.ctx.LUMINANCE,
            this.ctx.FLOAT,
            data.subarray(dataStart * width, (dataStart + height) * width)
        );
    }

    private getUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation {
        const location = this.ctx.getUniformLocation(program, name);

        if (location === null) {
            throw new Error(`Could not get uniform location for ${name}`);
        }

        return location;
    }

    private loadProgram(vertexShaderSrc: string, fragmentShaderSrc: string): WebGLProgram {
        const vertexShader = this.loadShader(this.ctx.VERTEX_SHADER, vertexShaderSrc);
        const fragmentShader = this.loadShader(this.ctx.FRAGMENT_SHADER, fragmentShaderSrc);

        const program = this.ctx.createProgram();
        if (program === null) {
            throw new Error('Failed to create program');
        }

        this.ctx.attachShader(program, vertexShader);
        this.ctx.attachShader(program, fragmentShader);
        this.ctx.linkProgram(program);

        if (!this.ctx.getProgramParameter(program, this.ctx.LINK_STATUS)) {
            const error = this.ctx.getProgramInfoLog(program);
            this.ctx.deleteProgram(program);
            throw new Error(`Failed to link program:\n${error}`);
        }

        return program;
    }

    private loadShader(type: number, src: string): WebGLShader {
        const shader = this.ctx.createShader(type);

        if (shader === null) {
            throw new Error('Could not create shader');
        }

        this.ctx.shaderSource(shader, src);
        this.ctx.compileShader(shader);

        if (!this.ctx.getShaderParameter(shader, this.ctx.COMPILE_STATUS)) {
            const error = this.ctx.getShaderInfoLog(shader);
            this.ctx.deleteShader(shader);
            throw new Error(`Failed to compile shader:\n${error}`);
        }

        return shader;
    }

    private createFullscreenQuad(): [WebGLBuffer, WebGLBuffer] {
        const vertexBuffer = this.ctx.createBuffer();
        const indexBuffer = this.ctx.createBuffer();

        if (vertexBuffer === null || indexBuffer === null) {
            throw new Error('Could not create buffer');
        }

        this.ctx.bindBuffer(this.ctx.ARRAY_BUFFER, vertexBuffer);
        this.ctx.bufferData(
            this.ctx.ARRAY_BUFFER,
            // (x, y, u, v) tuples for each vertex
            new Float32Array([
                // v0
                -1.0,
                1.0,
                0.0,
                0.0,
                // v1
                -1.0,
                -1.0,
                0.0,
                1.0,
                // v2
                1.0,
                -1.0,
                1.0,
                1.0,
                // v3
                1.0,
                1.0,
                1.0,
                0.0,
            ]),
            this.ctx.STATIC_DRAW
        );

        this.ctx.bindBuffer(this.ctx.ELEMENT_ARRAY_BUFFER, indexBuffer);
        this.ctx.bufferData(
            this.ctx.ELEMENT_ARRAY_BUFFER,
            new Uint16Array([0, 1, 3, 2, 3, 1]),
            this.ctx.STATIC_DRAW
        );

        return [vertexBuffer, indexBuffer];
    }

    private createSpectrogramTexture(width: number, height: number): WebGLTexture {
        const texture = this.ctx.createTexture();

        if (texture === null) {
            throw new Error('Could not create texture');
        }

        this.ctx.bindTexture(this.ctx.TEXTURE_2D, texture);
        this.ctx.texImage2D(
            this.ctx.TEXTURE_2D,
            0,
            this.ctx.LUMINANCE,
            width,
            height,
            0,
            this.ctx.LUMINANCE,
            this.ctx.FLOAT,
            new Float32Array(width * height)
        );
        this.ctx.texParameteri(
            this.ctx.TEXTURE_2D,
            this.ctx.TEXTURE_WRAP_S,
            this.ctx.CLAMP_TO_EDGE
        );
        this.ctx.texParameteri(
            this.ctx.TEXTURE_2D,
            this.ctx.TEXTURE_WRAP_T,
            this.ctx.CLAMP_TO_EDGE
        );
        this.ctx.texParameteri(this.ctx.TEXTURE_2D, this.ctx.TEXTURE_MIN_FILTER, this.ctx.LINEAR);
        this.ctx.texParameteri(this.ctx.TEXTURE_2D, this.ctx.TEXTURE_MAG_FILTER, this.ctx.LINEAR);

        return texture;
    }

    private updateScaleRange(
        scale: Scale,
        minFrequencyHz: number,
        maxFrequencyHz: number,
        sampleRate: number,
        windowSize: number
    ) {
        const peakHz = (sampleRate * (windowSize - 2)) / (2 * windowSize);
        switch (scale) {
            case 'linear':
                this.scaleRange = [minFrequencyHz / peakHz, maxFrequencyHz / peakHz];
                break;
            case 'mel':
                this.scaleRange = [
                    Math.log(1 + minFrequencyHz / 700) / Math.log(1 + peakHz / 700),
                    Math.log(1 + maxFrequencyHz / 700) / Math.log(1 + peakHz / 700),
                ];
                break;
            default:
                throw new Error('Unknown scale');
        }
    }

    private updateScaleTexture(scale: Scale, sampleRate: number, windowSize: number) {
        const buffer = new Float32Array(this.spectrogramHeight);
        for (let i = 0; i < this.spectrogramHeight; i += 1) {
            switch (scale) {
                case 'linear':
                    buffer[i] = i / (this.spectrogramHeight - 1);
                    break;
                case 'mel': {
                    const peakHz = (sampleRate * (windowSize - 2)) / (2 * windowSize);
                    buffer[i] =
                        (700 * ((1 + peakHz / 700) ** (i / (this.spectrogramHeight - 1)) - 1)) /
                        peakHz;
                    break;
                }
                default:
                    throw new Error('Unknown scale');
            }
        }

        if (this.scaleTexture === null) {
            this.scaleTexture = this.ctx.createTexture();

            if (this.scaleTexture === null) {
                throw new Error('Could not create texture');
            }
        }

        this.ctx.bindTexture(this.ctx.TEXTURE_2D, this.scaleTexture);
        this.ctx.texImage2D(
            this.ctx.TEXTURE_2D,
            0,
            this.ctx.LUMINANCE,
            1,
            this.spectrogramHeight,
            0,
            this.ctx.LUMINANCE,
            this.ctx.FLOAT,
            buffer
        );
        this.ctx.texParameteri(
            this.ctx.TEXTURE_2D,
            this.ctx.TEXTURE_WRAP_S,
            this.ctx.CLAMP_TO_EDGE
        );
        this.ctx.texParameteri(
            this.ctx.TEXTURE_2D,
            this.ctx.TEXTURE_WRAP_T,
            this.ctx.CLAMP_TO_EDGE
        );
        this.ctx.texParameteri(this.ctx.TEXTURE_2D, this.ctx.TEXTURE_MIN_FILTER, this.ctx.LINEAR);
        this.ctx.texParameteri(this.ctx.TEXTURE_2D, this.ctx.TEXTURE_MAG_FILTER, this.ctx.LINEAR);
    }

    private updateGradientTexture(gradient: Gradient) {
        const buffer = new Uint8Array(128 * 3);
        for (let i = 0; i < 128; i += 1) {
            const [r, g, b] = colorRamp(i / 127, gradient);
            buffer[i * 3] = r;
            buffer[i * 3 + 1] = g;
            buffer[i * 3 + 2] = b;
        }

        if (this.gradientTexture === null) {
            this.gradientTexture = this.ctx.createTexture();

            if (this.gradientTexture === null) {
                throw new Error('Could not create texture');
            }
        }

        this.ctx.bindTexture(this.ctx.TEXTURE_2D, this.gradientTexture);
        this.ctx.texImage2D(
            this.ctx.TEXTURE_2D,
            0,
            this.ctx.RGB,
            1,
            128,
            0,
            this.ctx.RGB,
            this.ctx.UNSIGNED_BYTE,
            buffer
        );
        this.ctx.texParameteri(
            this.ctx.TEXTURE_2D,
            this.ctx.TEXTURE_WRAP_S,
            this.ctx.CLAMP_TO_EDGE
        );
        this.ctx.texParameteri(
            this.ctx.TEXTURE_2D,
            this.ctx.TEXTURE_WRAP_T,
            this.ctx.CLAMP_TO_EDGE
        );
        this.ctx.texParameteri(this.ctx.TEXTURE_2D, this.ctx.TEXTURE_MIN_FILTER, this.ctx.LINEAR);
        this.ctx.texParameteri(this.ctx.TEXTURE_2D, this.ctx.TEXTURE_MAG_FILTER, this.ctx.LINEAR);
    }
}
