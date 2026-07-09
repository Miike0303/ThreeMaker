import { readFile } from 'node:fs/promises';

/**
 * Reads only the PNG `IHDR` chunk (bytes 16-23 of any valid PNG) to get pixel
 * dimensions without decoding the image. Test-only utility: the real desktop
 * app gets dimensions for free from the loaded `THREE.Texture`'s image
 * (`naturalWidth`/`naturalHeight`), so this manual parsing only exists to
 * feed the pure geometry layer real sheet sizes from Node, without adding an
 * image-decoding dependency.
 */
export async function readPngSize(filePath: string): Promise<{ width: number; height: number }> {
  const buffer = await readFile(filePath);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}
