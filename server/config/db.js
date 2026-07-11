import mongoose from 'mongoose';
import dns from 'node:dns';

const FALLBACK_DNS_SERVERS = ['8.8.8.8', '1.1.1.1'];

export async function connectDB() {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/superagent';
  const options = { dbName: process.env.MONGO_DB_NAME || 'superagent' };
  try {
    await mongoose.connect(uri, options);
  } catch (err) {
    const srvLookupRefused = uri.startsWith('mongodb+srv://')
      && err?.code === 'ECONNREFUSED'
      && err?.syscall === 'querySrv';

    if (!srvLookupRefused) throw err;

    const fallbackServers = (process.env.MONGODB_DNS_SERVERS || FALLBACK_DNS_SERVERS.join(','))
      .split(',')
      .map((server) => server.trim())
      .filter(Boolean);
    console.warn(`[db] system DNS refused the Atlas SRV lookup; retrying with ${fallbackServers.join(', ')}`);
    dns.setServers(fallbackServers);
    await mongoose.connect(uri, options);
  }
  console.log(`[db] connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
}
