import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('R5: no hardcoded runtime configuration in core', () => {
  it('contains no literal 20-byte token/Permit2 addresses in src/core/*.ts', () => {
    const coreDirectory = path.join(process.cwd(), 'src', 'core');
    const files = readdirSync(coreDirectory).filter((file) =>
      file.endsWith('.ts'),
    );

    expect(files.length).toBeGreaterThan(0);

    const offenders: Array<{ file: string; line: number; match: string }> = [];
    const addressPattern = /0x[0-9a-fA-F]{40}/g;

    for (const file of files) {
      const lines = readFileSync(path.join(coreDirectory, file), 'utf8').split(
        '\n',
      );

      lines.forEach((line, index) => {
        const matches = line.match(addressPattern);
        if (matches) {
          for (const match of matches) {
            offenders.push({ file, line: index + 1, match });
          }
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
