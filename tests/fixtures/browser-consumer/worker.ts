export { sharedConsumer } from './shared.js';
import type { TTSResponse, ImageEditOptions, VideoJob } from 'oneringai/types';
const portableMedia = (tts: TTSResponse, image: ImageEditOptions, video: VideoJob) => { const audio: Uint8Array = tts.audio; return { audio, image, video }; };
void portableMedia;
self.postMessage('worker');
// @ts-expect-error A Worker fixture must not acquire page globals transitively.
document.createElement('div');
// @ts-expect-error Node globals must remain absent.
process.cwd();
