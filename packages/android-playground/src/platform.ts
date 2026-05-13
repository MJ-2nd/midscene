import path from 'node:path';
import {
  AndroidAgent,
  AndroidDevice,
  getConnectedDevicesWithDetails,
} from '@midscene/android';
import {
  type PlaygroundSessionManager,
  type PlaygroundSessionTarget,
  // Scrcpy preview disabled — kept for future use
  // createScrcpyPreviewDescriptor,
  definePlaygroundPlatform,
} from '@midscene/playground';
import {
  PLAYGROUND_SERVER_PORT,
  // SCRCPY_SERVER_PORT,
} from '@midscene/shared/constants';
import { findAvailablePort } from '@midscene/shared/node';
// Scrcpy preview disabled — kept for future use
// import type ScrcpyServer from './scrcpy-server';

export interface AndroidPlatformOptions {
  staticDir?: string;
  // Scrcpy preview disabled — kept for future use
  // scrcpyServer?: ScrcpyServer;
  // scrcpyPort?: number;
}

async function getAdbTargets(): Promise<PlaygroundSessionTarget[]> {
  const devices = await getConnectedDevicesWithDetails();
  return devices
    .filter((device) => device.state === 'device')
    .map((device, index) => ({
      id: device.udid,
      label: device.udid,
      description:
        [device.model, device.resolution].filter(Boolean).join(' · ') ||
        device.state,
      status: device.state,
      isDefault: index === 0,
    }));
}

interface AdbTargetsResult {
  targets: PlaygroundSessionTarget[];
  error?: string;
}

async function getAdbTargetsSafe(): Promise<AdbTargetsResult> {
  try {
    return { targets: await getAdbTargets() };
  } catch (error) {
    return {
      targets: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const androidPlaygroundPlatform = definePlaygroundPlatform<
  AndroidPlatformOptions | undefined
>({
  id: 'android',
  title: 'Device Farm Playground',
  description: 'Android playground platform descriptor',
  async prepare(options) {
    const staticDir =
      options?.staticDir || path.join(__dirname, '../../static');
    const playgroundPort = await findAvailablePort(PLAYGROUND_SERVER_PORT);

    // Scrcpy preview disabled — kept for future use
    // const resolvedScrcpyPort = options?.scrcpyPort
    //   ? options.scrcpyPort
    //   : await findAvailablePort(SCRCPY_SERVER_PORT);
    // const scrcpyPort = resolvedScrcpyPort;

    if (playgroundPort !== PLAYGROUND_SERVER_PORT) {
      console.log(
        `⚠️  Port ${PLAYGROUND_SERVER_PORT} is busy, using port ${playgroundPort} instead`,
      );
    }

    const sessionManager: PlaygroundSessionManager = {
      async getSetupSchema() {
        const { targets, error } = await getAdbTargetsSafe();
        return {
          title: 'Welcome to\nDevice farm AI support!',
          description:
            'Select an available ADB device to create the current Android Agent',
          primaryActionLabel: 'Create Agent',
          autoSubmitWhenReady: targets.length === 1,
          notice: error
            ? {
                type: 'warning',
                message: 'Android device discovery failed',
                description: error,
              }
            : undefined,
          fields: [
            {
              key: 'deviceId',
              label: 'ADB device',
              type: 'select',
              required: true,
              options: targets.map((target) => ({
                label: target.label,
                value: target.id,
                description: target.description,
              })),
              defaultValue: targets.find((target) => target.isDefault)?.id,
              placeholder: 'Select a connected Android device',
            },
          ],
          targets,
        };
      },
      listTargets: async () => (await getAdbTargetsSafe()).targets,
      async createSession(input) {
        const targets = await getAdbTargets();
        const deviceId =
          typeof input?.deviceId === 'string' && input.deviceId
            ? input.deviceId
            : targets.find((target) => target.isDefault)?.id;

        if (!deviceId) {
          throw new Error(
            'No Android devices found. Connect a device with USB debugging enabled and try again.',
          );
        }

        const connectAgent = async () => {
          const device = new AndroidDevice(deviceId);
          await device.connect();
          return new AndroidAgent(device);
        };

        // Scrcpy preview disabled — kept for future use
        // if (options?.scrcpyServer) {
        //   options.scrcpyServer.currentDeviceId = deviceId;
        // }

        const agent = await connectAgent();

        return {
          agent,
          agentFactory: connectAgent,
          // Scrcpy preview disabled — kept for future use
          // preview: createScrcpyPreviewDescriptor(
          //   { scrcpyPort },
          //   { title: 'Android device preview' },
          // ),
          displayName: deviceId,
          metadata: {
            deviceId,
            // scrcpyPort,
          },
        };
      },
    };

    return {
      platformId: 'android',
      title: 'Device Farm Playground',
      sessionManager,
      // Scrcpy preview disabled — sidecars kept for future use
      // sidecars: options?.scrcpyServer
      //   ? [
      //       {
      //         id: 'android-scrcpy',
      //         start: async () => {
      //           await options.scrcpyServer?.launch(scrcpyPort);
      //         },
      //         stop: async () => {
      //           options.scrcpyServer?.close();
      //         },
      //       },
      //     ]
      //   : undefined,
      launchOptions: {
        port: playgroundPort,
        openBrowser: false,
        verbose: false,
        staticPath: staticDir,
        // Scrcpy preview disabled — kept for future use
        // configureServer(server) {
        //   server.scrcpyPort = scrcpyPort;
        // },
      },
      // Scrcpy preview disabled — kept for future use
      // preview: createScrcpyPreviewDescriptor(
      //   {
      //     scrcpyPort,
      //   },
      //   {
      //     title: 'Android device preview',
      //   },
      // ),
      metadata: {
        sessionConnected: false,
        setupState: 'required',
      },
    };
  },
});
