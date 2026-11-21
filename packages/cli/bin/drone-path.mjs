#!/usr/bin/env node
// bin/drone-path.mjs - launcher shim for the compiled CLI (dist/cli.js).
import { main } from '../dist/cli.js';

await main();
