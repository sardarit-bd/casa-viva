import { Router } from "express";
import { AuthRoutes } from "../modules/auth/auth.route.js";
import { PropertiesRoutes } from "../modules/properties/properties.route.js";
import { UploadRoutes } from "../modules/upload/upload.routes.js";
import { PaymentRoutes } from "../payments/payments.route.js";

export const router = Router()

const moduleRoutes = [
    {
        path: '/auth',
        route: AuthRoutes
    },
    {
        path: '/properties',
        route: PropertiesRoutes
    },
    {
        path: '/upload',
        route: UploadRoutes
    },
    {
        path: '/payment',
        route: PaymentRoutes
    }
]

moduleRoutes.forEach(route => {
    router.use(route.path, route.route)
})