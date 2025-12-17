import { Router } from "express";
import { AuthRoutes } from "../modules/auth/auth.route.js";
import { PropertiesRoutes } from "../modules/properties/properties.route.js";



export const router = Router()

const moduleRoutes = [
    {
        path: '/auth',
        route: AuthRoutes
    },
    {
        path: '/properties',
        route: PropertiesRoutes
    }
]

moduleRoutes.forEach(route => {
    router.use(route.path, route.route)
})