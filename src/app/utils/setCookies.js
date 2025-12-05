
export const setAuthCookie = (res, tokenInfo) => {
    if (tokenInfo.accessToken) {
        res.cookie('accessToken', tokenInfo.accessToken, {
            httpOnly: true,
            secure: true,
            sameSite: "none",
            maxAge: 1000 * 60 * 60 * 24
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