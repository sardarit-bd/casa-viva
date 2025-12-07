import { envVars } from "../config/env.js"

export const setAuthCookie = (res, tokenInfo) => {
    if (tokenInfo.accessToken) {
        res.cookie('accessToken', tokenInfo.accessToken, {
            httpOnly: true,
            secure: envVars.ENVAIRONMENT === 'production', // Production এ true
            sameSite: envVars.ENVAIRONMENT === 'production' ? 'none' : 'lax',
            maxAge: 24 * 60 * 60 * 1000, // 1 দিন
            // domain: envVars.ENVAIRONMENT === 'production' ? '.yourdomain.com' : undefined,
            path: '/',
        })
    }

    if (tokenInfo.refreshToken) {
        res.cookie('refreshToken', tokenInfo.refreshToken, {
            httpOnly: true,
            secure: true,
            sameSite: "none"
        })
    }
}
