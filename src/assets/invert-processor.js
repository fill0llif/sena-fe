class InvertProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            {
                name: 'delaySamples',
                defaultValue: 960, // ~1ms at 48kHz
                minValue: 0,
                maxValue: 1024
            }
        ];
    }
    constructor() {
        super();
        this.bufferSize = 2048; // must be > delaySamples
        this.buffer = [new Float32Array(this.bufferSize), new Float32Array(this.bufferSize)];
        this.writeIndex = 0;
    }

    process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];
        for (let ch = 0; ch < input.length; ch++) {
            const inCh = input[ch];
            const outCh = output[ch];
            const buf = this.buffer[ch];
            for (let i = 0; i < inCh.length; i++) {
                outCh[i] = -inCh[i]; // simple inversion
            }
        }
        return true;
    }
}

registerProcessor('invert-processor', InvertProcessor);