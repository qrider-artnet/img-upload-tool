import { readFile, writeFile } from 'node:fs/promises';

import { embed, type EmbedResult } from './embed.js';
import { isExiftoolAvailable } from './exiftool.js';
import { parseMetadataDocument, type MetadataDocument } from './schema.js';
import { readImageSource } from './sources.js';

interface CliArgs {
  readonly image: string;
  readonly metadata: string;
  readonly out: string | undefined;
}

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  if (!(await isExiftoolAvailable())) {
    throw new Error(
      'exiftool is required but was not found on PATH. Install it (e.g. ' +
        '`pacman -S perl-image-exiftool`, `brew install exiftool`, or `apt install libimage-exiftool-perl`).',
    );
  }

  const metadata = parseMetadataDocument(JSON.parse(await readFile(args.metadata, 'utf8')));
  const image = await readImageSource(args.image);
  const result = await embed(image, metadata);

  const outPath = args.out ?? defaultOutputPath(args.image, result.format);
  await writeFile(outPath, result.bytes);

  printSummary(metadata, result, outPath);
  if (!result.verification.ok) {
    process.exitCode = 1;
  }
};

const parseArgs = (argv: readonly string[]): CliArgs => {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === undefined || value === undefined || !flag.startsWith('--')) {
      throw new Error(`Bad argument near "${flag ?? ''}".`);
    }
    values[flag.slice(2)] = value;
  }
  const image = values['image'];
  const metadata = values['metadata'];
  if (image === undefined || metadata === undefined) {
    throw new Error(
      'Usage: metadata-tagger --image <path|gs://…|https://…> --metadata <doc.json> [--out <path>]',
    );
  }
  return { image, metadata, out: values['out'] };
};

const defaultOutputPath = (image: string, format: string): string => {
  const base = image.replace(/\.[^.]+$/, '');
  return `${base}.tagged.${format}`;
};

const printSummary = (
  doc: MetadataDocument,
  result: EmbedResult,
  outPath: string,
): void => {
  console.log(`\nArtwork layer (${doc.artworks.length} depicted):`);
  doc.artworks.forEach((artwork, index) => {
    const creator = artwork.creator?.join(', ') ?? '—';
    const copyright = artwork.copyrightNotice ?? '—';
    console.log(`  [${index + 1}] ${artwork.title ?? '(untitled)'} — ${creator}  (© ${copyright})`);
  });

  console.log('\nPhotograph layer:');
  console.log(`  Photographer: ${doc.photograph.creator?.join(', ') ?? '—'}`);
  console.log(`  Copyright:    ${doc.photograph.copyrightNotice ?? '—'}`);

  const verdict = result.verification.ok
    ? 'OK — all requested fields present in read-back'
    : `INCOMPLETE — missing: ${result.verification.missing.join(', ')}`;
  console.log(`\nVerify: ${verdict}`);
  console.log(`Output: ${outPath} (${result.format})\n`);
};

main().catch((error: unknown) => {
  console.error(`metadata-tagger: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
