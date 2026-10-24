import { connect } from 'node:net';

/**
 * Minimal clamd INSTREAM client. Resolves 'clean' or 'infected'; rejects on protocol/network
 * errors so the caller can mark the scan as failed and retry.
 */
export function clamavScan(host: string, port: number, data: Buffer, timeoutMs = 30_000): Promise<'clean' | 'infected'> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let reply = '';
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('clamd timeout')));
    socket.on('error', reject);
    socket.on('data', (d) => (reply += d.toString()));
    socket.on('end', () => {
      if (/OK\s*\0?$/.test(reply.trim())) resolve('clean');
      else if (/FOUND/.test(reply)) resolve('infected');
      else reject(new Error(`unexpected clamd reply: ${reply.slice(0, 200)}`));
    });
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      const chunk = 64 * 1024;
      for (let i = 0; i < data.length; i += chunk) {
        const part = data.subarray(i, i + chunk);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length);
        socket.write(len);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4)); // zero-length chunk terminates the stream
    });
  });
}
