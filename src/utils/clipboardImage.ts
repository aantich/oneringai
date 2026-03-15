/**
 * Clipboard image utilities
 * Reads images from clipboard (supports Mac, Linux, Windows)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const execAsync = promisify(exec);

/**
 * Safely clean up a temp file, ignoring errors
 */
function cleanupTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore cleanup errors - temp directory will eventually clean up
  }
}

export interface ClipboardImageResult {
  success: boolean;
  dataUri?: string;
  error?: string;
  format?: string;
}

/**
 * Read image from clipboard and convert to data URI
 */
export async function readClipboardImage(): Promise<ClipboardImageResult> {
  const platform = os.platform();

  try {
    switch (platform) {
      case 'darwin': // macOS
        return await readClipboardImageMac();
      case 'linux':
        return await readClipboardImageLinux();
      case 'win32':
        return await readClipboardImageWindows();
      default:
        return {
          success: false,
          error: `Unsupported platform: ${platform}`,
        };
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Read clipboard image on macOS
 */
async function readClipboardImageMac(): Promise<ClipboardImageResult> {
  const tempFile = path.join(os.tmpdir(), `clipboard-${Date.now()}.png`);

  try {
    // Try pngpaste first (brew install pngpaste)
    try {
      await execAsync(`pngpaste "${tempFile}"`);
      return await convertFileToDataUri(tempFile);
    } catch (pngpasteError) {
      // pngpaste not installed, try osascript
      const script = `
        set theFile to (POSIX file "${tempFile}")
        try
          set theImage to the clipboard as «class PNGf»
          set fileRef to open for access theFile with write permission
          write theImage to fileRef
          close access fileRef
          return "success"
        on error errMsg
          try
            close access theFile
          end try
          error errMsg
        end try
      `;

      const { stdout } = await execAsync(`osascript -e '${script}'`);

      if (stdout.includes('success') || fs.existsSync(tempFile)) {
        return await convertFileToDataUri(tempFile);
      }

      return {
        success: false,
        error: 'No image found in clipboard. Try copying an image first (Cmd+C or screenshot with Cmd+Ctrl+Shift+4)',
      };
    }
  } finally {
    // Always clean up temp file
    cleanupTempFile(tempFile);
  }
}

/**
 * Read clipboard image on Linux
 */
async function readClipboardImageLinux(): Promise<ClipboardImageResult> {
  const tempFile = path.join(os.tmpdir(), `clipboard-${Date.now()}.png`);

  try {
    // Try xclip
    try {
      await execAsync(`xclip -selection clipboard -t image/png -o > "${tempFile}"`);
      if (fs.existsSync(tempFile) && fs.statSync(tempFile).size > 0) {
        return await convertFileToDataUri(tempFile);
      }
    } catch {
      // xclip not available or failed
    }

    // Try wl-paste (Wayland)
    try {
      await execAsync(`wl-paste -t image/png > "${tempFile}"`);
      if (fs.existsSync(tempFile) && fs.statSync(tempFile).size > 0) {
        return await convertFileToDataUri(tempFile);
      }
    } catch {
      // wl-paste not available or failed
    }

    return {
      success: false,
      error: 'No image in clipboard. Install xclip (X11) or wl-clipboard (Wayland)',
    };
  } finally {
    // Always clean up temp file
    cleanupTempFile(tempFile);
  }
}

/**
 * Read clipboard image on Windows
 */
async function readClipboardImageWindows(): Promise<ClipboardImageResult> {
  const tempFile = path.join(os.tmpdir(), `clipboard-${Date.now()}.png`);

  try {
    // PowerShell script to save clipboard image
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms;
      $clip = [System.Windows.Forms.Clipboard]::GetImage();
      if ($clip -ne $null) {
        $clip.Save('${tempFile.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png);
        Write-Output 'success';
      } else {
        Write-Error 'No image in clipboard';
      }
    `;

    await execAsync(`powershell -Command "${psScript}"`);

    if (fs.existsSync(tempFile) && fs.statSync(tempFile).size > 0) {
      return await convertFileToDataUri(tempFile);
    }

    return {
      success: false,
      error: 'No image found in clipboard',
    };
  } finally {
    // Always clean up temp file
    cleanupTempFile(tempFile);
  }
}

/**
 * Convert image file to data URI
 * Note: Caller is responsible for temp file cleanup via finally block
 */
async function convertFileToDataUri(filePath: string): Promise<ClipboardImageResult> {
  try {
    const imageBuffer = await fs.promises.readFile(filePath);
    const base64Image = imageBuffer.toString('base64');

    // Detect format from file
    const magic = imageBuffer.slice(0, 4).toString('hex');
    let mimeType = 'image/png';

    if (magic.startsWith('89504e47')) {
      mimeType = 'image/png';
    } else if (magic.startsWith('ffd8ff')) {
      mimeType = 'image/jpeg';
    } else if (magic.startsWith('47494638')) {
      mimeType = 'image/gif';
    } else if (magic.startsWith('52494646')) {
      mimeType = 'image/webp';
    }

    const dataUri = `data:${mimeType};base64,${base64Image}`;

    return {
      success: true,
      dataUri,
      format: mimeType,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Check if clipboard contains an image (quick check)
 */
export async function hasClipboardImage(): Promise<boolean> {
  const platform = os.platform();

  try {
    switch (platform) {
      case 'darwin':
        // Check if clipboard has image data
        const { stdout } = await execAsync('osascript -e "clipboard info"');
        return stdout.includes('«class PNGf»') || stdout.includes('public.png');

      case 'linux':
        // Try xclip
        try {
          await execAsync('xclip -selection clipboard -t TARGETS -o | grep -q image');
          return true;
        } catch {
          return false;
        }

      case 'win32':
        // PowerShell check
        const psCheck = `
          Add-Type -AssemblyName System.Windows.Forms;
          if ([System.Windows.Forms.Clipboard]::GetImage() -ne $null) {
            Write-Output 'true'
          } else {
            Write-Output 'false'
          }
        `;
        const { stdout: result } = await execAsync(`powershell -Command "${psCheck}"`);
        return result.trim() === 'true';

      default:
        return false;
    }
  } catch {
    return false;
  }
}
