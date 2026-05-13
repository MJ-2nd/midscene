import path from 'node:path';
import {
  AndroidAgent,
  AndroidDevice,
} from '@midscene/android';
import {
  type LaunchPlaygroundResult,
  launchPreparedPlaygroundPlatform,
} from '@midscene/playground';
import cors from 'cors';
import express from 'express';

// --- Configuration ---

const MANAGER_PORT_DEFAULT = 5700;

// Port pool: fixed range of ports available for playground instances.
// Adjust POOL_START and POOL_SIZE to control capacity.
const POOL_START = 5801;
const POOL_SIZE = 10; // max 10 concurrent instances (ports 5801-5810)
const PORT_POOL = Array.from({ length: POOL_SIZE }, (_, i) => POOL_START + i);

// --- Types ---

interface ManagedInstance {
  port: number;
  deviceId: string;
  createdAt: number;
  playground: LaunchPlaygroundResult;
}

// --- Instance Registry ---

const instances = new Map<number, ManagedInstance>();

// --- Helpers ---

function acquirePort(): number | null {
  for (const port of PORT_POOL) {
    if (!instances.has(port)) {
      return port;
    }
  }
  return null; // pool exhausted
}

function createAgentFactory(deviceId: string) {
  return async () => {
    const device = new AndroidDevice(deviceId);
    await device.connect();
    return new AndroidAgent(device);
  };
}

async function launchInstance(
  deviceId: string,
  staticDir: string,
): Promise<ManagedInstance> {
  // Prevent duplicate: same device already has a running instance
  for (const instance of instances.values()) {
    if (instance.deviceId === deviceId) {
      throw new Error(
        `Device "${deviceId}" already has a running playground on port ${instance.port}`,
      );
    }
  }

  const port = acquirePort();
  if (port === null) {
    throw new Error(
      `Port pool exhausted (max ${POOL_SIZE} instances). Close an existing instance first.`,
    );
  }

  const agentFactory = createAgentFactory(deviceId);

  // Verify device connectivity before launching
  const testAgent = await agentFactory();

  const playground = await launchPreparedPlaygroundPlatform({
    platformId: 'android',
    title: 'Device Farm Playground',
    agentFactory,
    agent: testAgent,
    launchOptions: {
      port,
      openBrowser: false,
      verbose: false,
      staticPath: staticDir,
    },
    metadata: {
      deviceId,
    },
  });

  const instance: ManagedInstance = {
    port: playground.port,
    deviceId,
    createdAt: Date.now(),
    playground,
  };

  instances.set(instance.port, instance);
  return instance;
}

async function closeInstance(port: number): Promise<void> {
  const instance = instances.get(port);
  if (!instance) {
    throw new Error(`No playground instance running on port ${port}`);
  }

  await instance.playground.close();
  instances.delete(port);
}

function listInstances() {
  return Array.from(instances.values()).map((inst) => ({
    port: inst.port,
    deviceId: inst.deviceId,
    createdAt: inst.createdAt,
  }));
}

// --- Express Server ---

export async function startManager(
  managerPort: number = MANAGER_PORT_DEFAULT,
  staticDir?: string,
) {
  const resolvedStaticDir =
    staticDir || path.join(__dirname, '../../static');

  const app = express();
  app.use(cors());
  app.use(express.json());

  // POST /playground  — launch a new playground for a device
  // Body: { "deviceId": "192.168.1.10:5555" }
  // Response: { "port": 5801, "deviceId": "..." }
  app.post('/playground', async (req, res) => {
    const { deviceId } = req.body || {};
    if (!deviceId || typeof deviceId !== 'string') {
      res.status(400).json({ error: 'deviceId is required (string)' });
      return;
    }

    try {
      const instance = await launchInstance(deviceId, resolvedStaticDir);
      console.log(
        `  Started playground for device "${deviceId}" on port ${instance.port}`,
      );
      res.json({
        port: instance.port,
        deviceId: instance.deviceId,
        createdAt: instance.createdAt,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      console.error(`  Failed to launch for "${deviceId}": ${message}`);
      res.status(500).json({ error: message });
    }
  });

  // DELETE /playground/:port  — close a running playground instance
  // Response: { "status": "closed", "port": 5801 }
  app.delete('/playground/:port', async (req, res) => {
    const port = Number(req.params.port);
    if (!port || Number.isNaN(port)) {
      res.status(400).json({ error: 'Invalid port number' });
      return;
    }

    try {
      const instance = instances.get(port);
      const deviceId = instance?.deviceId;
      await closeInstance(port);
      console.log(
        `  Closed playground on port ${port} (device: ${deviceId})`,
      );
      res.json({ status: 'closed', port });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      res.status(404).json({ error: message });
    }
  });

  // GET /playgrounds  — list all running instances
  // Response: [ { port, deviceId, createdAt }, ... ]
  app.get('/playgrounds', (_req, res) => {
    res.json({
      instances: listInstances(),
      pool: {
        total: POOL_SIZE,
        used: instances.size,
        available: POOL_SIZE - instances.size,
        portRange: `${POOL_START}-${POOL_START + POOL_SIZE - 1}`,
      },
    });
  });

  // Start manager server
  return new Promise<void>((resolve, reject) => {
    const server = app.listen(managerPort, () => {
      console.log('');
      console.log('=== Device Farm Playground Manager ===');
      console.log(`  Manager API:  http://0.0.0.0:${managerPort}`);
      console.log(`  Port pool:    ${POOL_START}-${POOL_START + POOL_SIZE - 1} (${POOL_SIZE} slots)`);
      console.log('');
      console.log('  Endpoints:');
      console.log(
        '    POST   /playground        — Launch playground for a device',
      );
      console.log(
        '    DELETE /playground/:port   — Close a playground instance',
      );
      console.log(
        '    GET    /playgrounds        — List running instances',
      );
      console.log('');
      resolve();
    });

    server.on('error', reject);

    // Graceful shutdown: close all instances when manager exits
    const shutdown = async () => {
      console.log('\nShutting down manager...');
      const ports = Array.from(instances.keys());
      for (const port of ports) {
        try {
          await closeInstance(port);
          console.log(`  Closed instance on port ${port}`);
        } catch {
          // best-effort
        }
      }
      server.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}
