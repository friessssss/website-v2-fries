declare module 'webgl-fluid' {
  type WebGLFluidConfig = Record<string, unknown>;

  export default function WebGLFluid(
    canvas: HTMLCanvasElement,
    config?: WebGLFluidConfig,
  ): () => void;
}

