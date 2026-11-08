export { sharedConsumer } from './shared.js';
import { OpenAIRealtimeWebRTCPeer } from 'oneringai/realtime-browser';
import type { TTSResponse, ImageEditOptions, VideoJob } from 'oneringai/types';
const portableMedia = (tts: TTSResponse, image: ImageEditOptions, video: VideoJob) => { const audio: Uint8Array = tts.audio; return { audio, image, video }; };
void portableMedia;
void OpenAIRealtimeWebRTCPeer;
document.createElement('div');
// @ts-expect-error The browser declaration graph must not install Node globals.
process.cwd();
// @ts-expect-error Buffer is not a browser ambient.
Buffer.from('not installed');
