class WhiteNoiseInvertProcessor extends AudioWorkletProcessor {
    process(inputs, outputs) {
        const output = outputs[0];
        for (let ch = 0; ch < output.length; ch++) {
            const channel = output[ch];
            for (let i = 0; i < channel.length; i++) {
                channel[i] = (Math.random() * 2 - 1) * 0.1; // white noise, scaled
            }
        }
        return true;
    }
}

registerProcessor('white-noise-processor', WhiteNoiseInvertProcessor);