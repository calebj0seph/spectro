declare module '*.worker.ts' {
    class WebpackWorker extends Worker {
        constructor();
    }

    export default WebpackWorker;
}

declare module '*.glsl' {
    import { GlslShader } from 'webpack-glsl-minify';

    const shader: GlslShader;
    export default shader;
}
