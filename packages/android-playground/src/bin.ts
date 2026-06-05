import fs from 'node:fs';
import path from 'node:path';
import { launchPreparedPlaygroundPlatform } from '@midscene/playground';
import { androidPlaygroundPlatform } from './platform';
// Scrcpy preview disabled — kept for future use
// import ScrcpyServer from './scrcpy-server';

const staticDir =
  [
    path.join(__dirname, 'static'), // standalone bundle
    path.join(__dirname, '../../static'), // normal dist/lib layout
  ].find((d) => fs.existsSync(d)) || path.join(__dirname, '../../static');

const isManagerMode = process.argv.includes('--manager');

const startSingleInstance = async () => {
  const { default: open } = await import('open');

  try {
    // Scrcpy preview disabled — kept for future use
    // const scrcpyServer = new ScrcpyServer();
    const prepared = await androidPlaygroundPlatform.prepare({
      staticDir,
      // scrcpyServer,
    });

    console.log('Starting servers...');

    const playgroundResult = await launchPreparedPlaygroundPlatform(prepared);

    const playgroundServer = playgroundResult.server;

    console.log('');
    console.log('Device Farm Playground is ready!');
    console.log(`Playground: http://localhost:${playgroundServer.port}`);
    console.log(`Generated Server ID: ${playgroundServer.id}`);
    console.log('');

    open(`http://localhost:${playgroundServer.port}`);
  } catch (error) {
    console.error('Failed to start servers:', error);
    process.exit(1);
  }
};

const startManagerMode = async () => {
  const { startManager } = await import('./manager');
  const portArg = process.argv.find((arg) => arg.startsWith('--port='));
  const port = portArg ? Number(portArg.split('=')[1]) : undefined;

  try {
    await startManager(port, staticDir);
  } catch (error) {
    console.error('Failed to start manager:', error);
    process.exit(1);
  }
};

if (isManagerMode) {
  startManagerMode();
} else {
  startSingleInstance();
}
