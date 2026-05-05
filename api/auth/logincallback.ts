import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import {serialize} from 'cookie';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET!;

export default async function handler(req: VercelRequest, res: VercelResponse) {

    //1 - Get GitHub access token

    const code = req.query.code as string;

    const tokenRes = await axios.post(
        'https://github.com/login/oauth/access_token',
        {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        },
        { headers: { Accept: 'application/json' } }
    );

    const accessToken = tokenRes.data.access_token;

    //2 - Get user info from GitHub

    const userRes = await axios.get('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    const user = userRes.data;

    //3 - Create JWT token

    const jwtToken = jwt.sign(
        {
            accessToken,
            username: user.login,
        },
        JWT_SECRET,
        { expiresIn: '1d' }
    );
    
    //4 - Set HttpOnly cookie and redirect

    res.setHeader('Set-Cookie', serialize('session_token', jwtToken, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: '/',
        maxAge: 60 * 60 * 24, // 1 day
    }));

    console.log("JWT token set in cookie", jwtToken);
    console.log("Headers", res.getHeaders());
    

    const frontendUrl = process.env.FRONTEND_URL;
    res.redirect(`${frontendUrl}`);
}
