/**
 * Control-protocol integration: command → state_changed round-trips over both
 * WebSocket (FR-R5) and the REST mirror (FR-R2), against a real listening server.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION } from '@openhearth/shared';
import { buildApp } from './app.js';
import { ConfigService } from './core/ConfigService.js';
import { ControlService } from './core/ControlService.js';

let dir: string;
let cfg: ConfigService;
let app: FastifyInstance;
let baseUrl: string;
let wsUrl: string;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'oh-ctrl-'));
  cfg = new ConfigService({ configDir: dir });
  await cfg.load();
  app = buildApp({ configService: cfg, logLevel: 'silent', controlService: new ControlService() });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/api/v1/control/ws`;
});

afterEach(async () => {
  await app.close();
  await cfg.stop();
  await fsp.rm(dir, { recursive: true, force: true });
});

/**
 * A WS client that buffers every message from creation, so a `waitFor` never
 * races the server's immediate on-connect message.
 */
interface WsMessage {
  type?: string;
  event?: string;
  state?: Record<string, unknown>;
  details?: unknown;
}

class Client {
  readonly ws: WebSocket;
  private readonly queue: WsMessage[] = [];
  private waiter: { pred: (m: WsMessage) => boolean; resolve: (m: WsMessage) => void } | undefined;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString()) as WsMessage;
      if (this.waiter && this.waiter.pred(msg)) {
        const w = this.waiter;
        this.waiter = undefined;
        w.resolve(msg);
      } else {
        this.queue.push(msg);
      }
    });
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
  }

  waitFor(pred: (m: WsMessage) => boolean, timeoutMs = 2000): Promise<WsMessage> {
    const buffered = this.queue.findIndex(pred);
    if (buffered >= 0) return Promise.resolve(this.queue.splice(buffered, 1)[0]!);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timed out waiting for ws message')),
        timeoutMs,
      );
      this.waiter = {
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      };
    });
  }

  send(obj: unknown): void {
    this.ws.send(JSON.stringify(obj));
  }

  close(): void {
    this.ws.close();
  }
}

describe('REST mirror', () => {
  it('GET /api/v1/state returns the snapshot', async () => {
    const res = await fetch(`${baseUrl}/api/v1/state`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ screen: 'home', volume: 50 });
  });

  it('POST /api/v1/control/command applies a command (FR-R2)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/control/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'command',
        protocol_version: PROTOCOL_VERSION,
        action: 'set_volume',
        params: { level: 33 },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: { volume: number } };
    expect(body.state).toMatchObject({ volume: 33 });
    // The state mutation is visible on the next GET.
    const snapshot = (await (await fetch(`${baseUrl}/api/v1/state`)).json()) as { volume: number };
    expect(snapshot).toMatchObject({ volume: 33 });
  });

  it('rejects an invalid command with 400', async () => {
    const res = await fetch(`${baseUrl}/api/v1/control/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'command',
        protocol_version: PROTOCOL_VERSION,
        action: 'explode',
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('WebSocket control channel (FR-R5)', () => {
  it('sends the current state on connect and broadcasts state_changed on a command', async () => {
    const c = new Client(wsUrl);
    await c.open();

    const initial = await c.waitFor((m) => m.event === 'state_changed');
    expect(initial.state).toMatchObject({ screen: 'home', volume: 50 });

    c.send({
      type: 'command',
      protocol_version: PROTOCOL_VERSION,
      action: 'set_volume',
      params: { level: 88 },
    });
    const event = await c.waitFor((m) => m.state?.volume === 88);
    expect(event).toMatchObject({ type: 'event', event: 'state_changed', state: { volume: 88 } });

    c.close();
  });

  it('broadcasts one client’s command to all connected clients', async () => {
    const a = new Client(wsUrl);
    const b = new Client(wsUrl);
    await Promise.all([a.open(), b.open()]);
    await Promise.all([
      a.waitFor((m) => m.event === 'state_changed'),
      b.waitFor((m) => m.event === 'state_changed'),
    ]);

    a.send({
      type: 'command',
      protocol_version: PROTOCOL_VERSION,
      action: 'launch_service',
      params: { service_id: 'netflix' },
    });
    const received = await b.waitFor((m) => m.state?.service_id === 'netflix');
    expect(received.state).toMatchObject({ screen: 'service', service_id: 'netflix' });

    a.close();
    b.close();
  });

  it('propagates a REST command to connected WS subscribers (FR-R2/R5 parity)', async () => {
    const c = new Client(wsUrl);
    await c.open();
    await c.waitFor((m) => m.event === 'state_changed'); // initial

    // Fire the command over REST; the WS client must receive the broadcast.
    const broadcast = c.waitFor((m) => m.state?.volume === 77);
    const res = await fetch(`${baseUrl}/api/v1/control/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'command',
        protocol_version: PROTOCOL_VERSION,
        action: 'set_volume',
        params: { level: 77 },
      }),
    });
    expect(res.status).toBe(200);
    expect(await broadcast).toMatchObject({ event: 'state_changed', state: { volume: 77 } });
    c.close();
  });

  it('replies with an error for a malformed command, without dropping the connection', async () => {
    const c = new Client(wsUrl);
    await c.open();
    await c.waitFor((m) => m.event === 'state_changed'); // initial

    c.send({ type: 'command', protocol_version: PROTOCOL_VERSION, action: 'nope' });
    expect(await c.waitFor((m) => m.type === 'error')).toMatchObject({ type: 'error' });
    expect(c.ws.readyState).toBe(WebSocket.OPEN); // still connected
    c.close();
  });
});
