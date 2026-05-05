import type { VercelRequest, VercelResponse } from '@vercel/node';
import { serialize } from 'cookie';

export default function handler(req: VercelRequest, res: VercelResponse) {
    const frontendUrl = process.env.FRONTEND_URL;

    // Borra la cookie estableciendo maxAge en 0
    res.setHeader('Set-Cookie', serialize('session_token', '', {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 0, //Expire immediatly
    }));

    res.redirect(`${frontendUrl}`);
}
