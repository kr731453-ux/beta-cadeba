import { env } from 'cloudflare:workers';
import { jwksResponse } from '../../../server/admin-sessions.js';
export const dynamic = 'force-dynamic';
export const GET = () => jwksResponse(env);
