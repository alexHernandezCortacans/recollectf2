import type { VercelRequest, VercelResponse } from '@vercel/node';
import { log } from 'console';
import { parse } from 'cookie';
import jwt from 'jsonwebtoken';

export default function handler(req: VercelRequest, res: VercelResponse) {

    //1 - Allow CORS
    const origin = "https://erilllab.github.io" //change in dev

    res.setHeader("Access-Control-Allow-Origin", origin); // to be changed in prod
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
    if (req.method === "OPTIONS") {
      return res.status(200).end(); // CORS preflight
    }

    //2 - Verify JWT token from cookies and return

    console.log("Cookie: ", req.headers.cookie);

    const cookies = parse(req.headers.cookie || '');

    console.log("Session token: ", cookies.session_token);
    const token = cookies.session_token;

    log("Token: ", token);

    if (!token) {
        log("No token provided");
        return res.status(401).json({ error: 'No token provided' });
    }

    type MyTokenPayload = {
        username: string;
        accessToken: string;
        iat?: number;
        exp?: number;
    };

    try {
        const { username } = jwt.verify(token, process.env.JWT_SECRET!) as MyTokenPayload;
        log("Token payload: ", username);
        return res.status(200).json({ username });
    } catch (err) {
        log("Invalid token: ", err);
        return res.status(401).json({ error: 'Invalid token' });
  }
}
