declare module 'opus-recorder' {
  export default class Recorder {
    constructor(options: {
      encoderPath: string;
      encoderApplication?: number;
      streamPages?: boolean;
      mimeType?: string;
      bufferLength?: number;
      sourceNode?: AudioNode;
    });
    init(stream: MediaStream): void;
    start(): void;
    stop(): void;
    close(): void;
    ondataavailable?: (data: Uint8Array) => void;
  }
}