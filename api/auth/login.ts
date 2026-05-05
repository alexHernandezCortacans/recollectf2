import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {

    //1 - Send user to Github login page
    const client_id = process.env.GITHUB_CLIENT_ID!;
    const redirect_uri = process.env.LOGIN_REDIRECT_URI!;
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${client_id}&redirect_uri=${redirect_uri}&scope=read:user`;
    res.redirect(githubAuthUrl);
}
