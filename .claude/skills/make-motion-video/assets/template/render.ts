import {renderVideo} from '@revideo/renderer';

const variants = process.argv.length > 2 ? process.argv.slice(2) : ['main'];

for (const variant of variants) {
  const file = await renderVideo({
    projectFile: './src/project.tsx',
    variables: {variant},
    settings: {
      outFile: `${variant}.mp4`,
      outDir: './output',
      logProgress: true,
    },
  });
  console.log('rendered:', file);
}
