import { VercelRequest, VercelResponse } from '@vercel/node';
import { originConstGlobal, REPO_OWNER_GLOBAL } from '../../consts';
import { verify } from 'jsonwebtoken';
import axios from 'axios';
import { parse } from 'cookie';
import { use } from 'react';

const BOT_TOKEN = process.env.BOT_TOKEN!;
const JWT_SECRET = process.env.JWT_SECRET!;
const REPO_OWNER = REPO_OWNER_GLOBAL;
const REPO_NAME = 'reCollecTF';

export default async function handler(req: VercelRequest, res: VercelResponse) {

    //1 - Allow CORS
    console.log("Setting CORS Policy...");

    const origin = originConstGlobal;

    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    
    if (req.method === "OPTIONS") {
        console.log("CORS OPTINS request");
        return res.status(200).end(); // CORS preflight
    }

    //2 - Get JWT token from cookies
    console.log("Getting JWT...");
    
    const cookies = parse(req.headers.cookie || '');
    const token = cookies.session_token;

    console.log("token: ", token);
    
    if (!token) {
        console.log("No token provided");
        
        return res.status(401).json({ error: 'No token provided' });
    }

    //3 - Get user info from JWT token

    let payload;
    try {
        console.log("Verifying token...");
        payload = verify(token, JWT_SECRET) as any;
        console.log("Token verified ", payload);
    } catch (err) {
        console.log("Token not verified.");
        return res.status(401).json({ error: 'Invalid token' });
    }

    const username = payload.username;

    console.log("UserName: ", username);
    

    //3 - Check if user is a collaborator

    try {
        console.log("Calling GH API...: ", BOT_TOKEN);
        
        const response = await axios.get(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/collaborators/${username}`,
        {
            headers: {
            Authorization: `Bearer ${BOT_TOKEN}`,
            Accept: 'application/vnd.github+json',
            },
            validateStatus: status => status === 204 || status === 404,
        }
        );

        const isCollaborator = response.status === 204;

        console.log("IsCollaborator: ", isCollaborator);
        
        
        if (!isCollaborator && username === REPO_OWNER) {
            console.log('User is the owner of the repository');
            return res.status(200).json({ isCollaborator });
        }
        return res.status(200).json({ isCollaborator });
    } catch (err) {
        return res.status(500).json({ error: err });
    }
}
