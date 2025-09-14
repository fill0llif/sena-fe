/// <reference lib="webworker" />

import { OggOpusDecoderWebWorker } from 'ogg-opus-decoder';

let decoder: OggOpusDecoderWebWorker;

addEventListener('message', async ({ data }) => {
  const { type, _data } = data;
  if (type === 'init') {
    decoder = new OggOpusDecoderWebWorker();
    await decoder.ready;
    postMessage({ type: 'ready' });
  }
  if (decoder && type === 'decode') {
    decoder.decode(new Uint8Array(_data))
      .then((decoded) => {
        postMessage({ type: 'decoded', _data: decoded });
      }).catch((error) => {
        console.error('Decoding error:', error);
      });
  }
  if (decoder && type === 'free') {
    decoder.free();
  }
});
