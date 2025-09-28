import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { environment } from '../environments/environment';
import Recorder from 'opus-recorder';
import { connect } from 'rxjs';

@Component({
  selector: 'app-root',
  imports: [CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  protected readonly title = signal('sena');
  protected readonly errorMessage = signal<string | null>(null);

  private micStream: MediaStream | null = null;
  private processingAudioWs: WebSocket | null = null;
  private noiseCancelledVoiceChangedAudioOutput: HTMLAudioElement | null = null;
  private audioContext: AudioContext | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private voiceChangerSource: MediaStreamAudioSourceNode | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private opusRecorder: Recorder | null = null;
  private worker: Worker | null = null;

  isOnline = navigator.onLine;
  isListening = false;
  isPlaying = false;
  inputs: MediaDeviceInfo[] = [];
  outputs: MediaDeviceInfo[] = [];
  selectedInput: string = '';
  selectedOutput: string = '';
  isEnabled = false;

  async ngOnInit(): Promise<void> {
    this.setupOpusDecoderWebWorker();
    window.addEventListener('online', () => this.isOnline = true);
    window.addEventListener('offline', () => this.isOnline = false);
    this.loadDevices();
  }

  private setupOpusDecoderWebWorker() {
    if (typeof Worker !== 'undefined') {
      this.worker = new Worker(new URL('./app.worker', import.meta.url));
      this.worker.onmessage = ({ data }) => {
        const { type, _data } = data;
        if (type === 'ready') {
          console.log('Decoder ready');
        }
        if (type === 'decoded') {
          const {
            channelData,
            samplesDecoded,
            sampleRate
          } = _data;
          if (samplesDecoded > 0 && channelData[0] && sampleRate) {
            this.playPcm(channelData[0], sampleRate);
          }
        }
      };
      this.worker.onerror = (error) => console.error('Worker error:', error);
      this.worker.postMessage({ type: 'init' });
    } else {
      console.error('Web Workers are not supported in this environment.');
    }
  }

  private playPcm(
    mono: Float32Array,
    sampleRate: number) {
    if (this.audioContext && this.destination) {
      const buffer = this.audioContext.createBuffer(1, mono.length, sampleRate);
      buffer.getChannelData(0).set(mono);
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.destination);
      source.start();
    } else {
      console.warn('Selected speaker not available');
    }
  }

  async loadDevices() {
    await navigator.mediaDevices.getUserMedia({ audio: true });
    const devices = await navigator.mediaDevices.enumerateDevices();
    console.log(devices);
    this.inputs = devices.filter(d => d.kind === 'audioinput');
    this.outputs = devices.filter(d => d.kind === 'audiooutput');
  }

  onInputChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    const deviceId = target.value;
    this.selectedInput = deviceId;
  }

  onOutputChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    const deviceId = target.value;
    this.selectedOutput = deviceId;
  }

  private async enable(): Promise<boolean> {
    this.errorMessage.set(null);
    //open websocket to backend
    const ws = await this.openProcessingAudioWs();
    if (ws instanceof Error) {
      this.errorMessage.set(ws.message);
      this.cleanResources();
      return false;
    }
    this.processingAudioWs = ws;
    //try acquire mic stream
    const micStream = await this.acquireMicStream(this.selectedInput);
    //close websocket if mic stream failed
    if (micStream instanceof Error) {
      this.errorMessage.set(micStream.message);
      this.cleanResources();
      return false;
    }
    this.micStream = micStream;
    this.isListening = true;
    //try setup selected speaker
    const audioOutput = await this.setupSpeaker(this.selectedOutput);
    if (audioOutput instanceof Error) {
      this.errorMessage.set(audioOutput.message);
      this.cleanResources();
      return false;
    }
    this.noiseCancelledVoiceChangedAudioOutput = audioOutput;
    this.audioContext = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    await this.audioContext.audioWorklet.addModule('/assets/white-noise-processor.js');
    const whiteNoiseProcessor = new AudioWorkletNode(this.audioContext, 'white-noise-processor');
    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1000;
    filter.Q.value = 1;
    this.micSource = this.audioContext.createMediaStreamSource(this.micStream);
    //create destination for audio output
    this.destination = this.audioContext.createMediaStreamDestination();
    this.noiseCancelledVoiceChangedAudioOutput.srcObject = this.destination.stream;
    //play noise cancelled audio to the speaker
    this.noiseCancelledVoiceChangedAudioOutput.play();
    this.isPlaying = true;
    //connect mic to speaker
    //this.micSource.connect(whiteNoiseProcessor).connect(filter).connect(this.destination);
    //listen to processed voice changed audio and play it to the selected speaker
    this.enableVoiceChangedPlayback(
      this.processingAudioWs);
    //send mic audio to backend for processing
    const voiceProcessingEnabled = await this.enableVoiceProcessing(
      this.audioContext,
      this.micSource);
    if (voiceProcessingEnabled instanceof Error) {
      this.errorMessage.set(voiceProcessingEnabled.message);
      this.cleanResources();
      return false;
    }
    return true;
  }

  private async openProcessingAudioWs(): Promise<WebSocket | Error> {
    try {
      const processingAudioWs = new WebSocket(environment.backendWebSocketUrl);
      processingAudioWs.binaryType = "arraybuffer";
      await this.waitForSocketToOpen(processingAudioWs);
      return processingAudioWs;
    } catch (err) {
      console.error('Websocket connection failed:', err);
      return new Error("Failed to connect to backend for audio processing", { cause: err });
    }
  }

  private waitForSocketToOpen(socket: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      if (socket.readyState === WebSocket.OPEN) {
        resolve();
      } else {
        socket.addEventListener('open', () => resolve(), { once: true });
        socket.addEventListener('error', (err) => reject(err), { once: true });
      }
    });
  }

  private cleanResources() {
    this.processingAudioWs?.close();
    this.processingAudioWs = null;
    this.micStream?.getTracks().forEach(track => track.stop());
    this.micStream = null;
    this.noiseCancelledVoiceChangedAudioOutput?.pause();
    this.noiseCancelledVoiceChangedAudioOutput = null;
    this.audioContext?.close();
    this.audioContext = null;
    this.worker?.postMessage({ type: 'free' });
    this.destination = null;
    this.micSource = null;
    this.voiceChangerSource = null;
    this.opusRecorder?.stop();
    this.opusRecorder?.close();
    this.opusRecorder = null;
    this.isPlaying = false;
    this.isListening = false;
  }

  private async acquireMicStream(
    deviceId: string): Promise<MediaStream | Error> {
    try {
      console.log(navigator.mediaDevices.getSupportedConstraints());
      //get selected mic stream
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          latency: { ideal: 0.01 }
        } as MediaTrackConstraints
      });
    } catch (err) {
      return new Error("Failed to access selected microphone", { cause: err });
    }
  }

  private async setupSpeaker(
    deviceId: string): Promise<HTMLAudioElement | Error> {
    try {
      //setup audio destination to play on selected output device
      const audioElement = new Audio();
      if ('setSinkId' in audioElement) {
        await audioElement.setSinkId(deviceId);
      }
      audioElement.autoplay = true;
      return audioElement;
    } catch (err) {
      return new Error("Failed to setup selected speaker", { cause: err });
    }
  }

  private enableVoiceChangedPlayback(
    processingAudioWs: WebSocket) {
    processingAudioWs.onmessage = async (event) => {
      if (this.worker) {
        this.worker.postMessage({ type: 'decode', _data: event.data }, [event.data]);
      } else {
        console.warn('Worker not available');
      }
    };
  }

  private duplicateSource(
    audioContext: AudioContext,
    source: MediaStreamAudioSourceNode): MediaStreamAudioSourceNode {
    const destination = audioContext.createMediaStreamDestination();
    source.connect(destination);
    const duplicated = audioContext.createMediaStreamSource(destination.stream);
    return duplicated;
  }

  private async enableVoiceProcessing(
    audioContext: AudioContext,
    micSource: MediaStreamAudioSourceNode): Promise<Error | boolean> {
    try {
      //duplicate mic source for voice changer processing
      this.voiceChangerSource = this.duplicateSource(audioContext, micSource);

      //read audio from mic and send it to backend for processing
      this.opusRecorder = new Recorder({
        encoderPath: 'assets/encoderWorker.min.js',
        //low delay real time
        encoderApplication: 2051,
        streamPages: true,
        mimeType: 'audio/ogg; codecs=opus',
        sourceNode: this.voiceChangerSource
      });
      this.opusRecorder.ondataavailable = (typedArray: Uint8Array) => {
        if (typedArray &&
          this.processingAudioWs &&
          this.processingAudioWs.readyState === WebSocket.OPEN) {
          this.processingAudioWs.send(typedArray.buffer);
        } else {
          console.warn('no websocket or data available');
        }
      };

      this.opusRecorder.start();

      return true;
    } catch (err) {
      return new Error("Failed to access selected microphone", { cause: err });
    }
  }

  async toggleEnabled() {
    this.isEnabled = !this.isEnabled;
    if (this.isEnabled) {
      this.isEnabled = await this.enable();
      if (!this.isEnabled) {
        this.errorMessage.set('Failed to enable audio processing');
      }
    } else {
      this.cleanResources();
    }
  }

}
