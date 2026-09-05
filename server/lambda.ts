import serverless from 'serverless-http';
import { createApp } from './app.ts';

// API Gateway HTTP API adapter. Dependencies are created inside createApp so
// Lambda can select AWS-backed adapters using its environment configuration.
export const handler = serverless(createApp());
