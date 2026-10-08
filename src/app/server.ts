import { buildApp } from './buildApp.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp(config);

await app.listen({ port: config.PORT, host: '0.0.0.0' });
