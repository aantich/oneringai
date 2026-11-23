import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createMessageWithImages } from 'oneringai';
import type { CommandContext, CommandResult } from '../../config/types.js';
import { BaseCommand } from '../BaseCommand.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function imageMediaType(data: Buffer): string | undefined {
  if (data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
}

export class ImageCommand extends BaseCommand {
  readonly name = 'image';
  readonly aliases = [];
  readonly description = 'Send a local PNG, JPEG, or WebP image to the active agent';
  readonly usage = '/image <path> [question]';

  async execute({ app, args }: CommandContext): Promise<CommandResult> {
    const [file, ...question] = args;
    if (!file) return this.error(`Usage: ${this.usage}. Quote paths containing spaces.`);
    if (!app.getAgent()?.isReady()) return this.error('Configure an agent with /connector add first.');

    const path = file.startsWith('~/') ? join(homedir(), file.slice(2)) : file;
    const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) return this.error('Choose a local image file.');
      if (stat.size > MAX_IMAGE_BYTES) return this.error('Choose an image up to 10 MiB.');

      const data = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < data.length) {
        const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset !== stat.size || (await handle.stat()).mtimeMs !== stat.mtimeMs) {
        return this.error('The image changed while reading it. Try again.');
      }

      const mediaType = imageMediaType(data);
      if (!mediaType) return this.error('Choose a PNG, JPEG, or WebP image.');
      const prompt = question.join(' ').trim() || 'What is in this image?';
      const image = `data:${mediaType};base64,${data.toString('base64')}`;
      return { success: true, agentInput: [createMessageWithImages(prompt, [image])] };
    } finally {
      await handle.close();
    }
  }
}
