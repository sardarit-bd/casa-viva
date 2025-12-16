import { Router } from "express";
import { AuthControllers } from "./auth.controller.js";
import { checkAuth } from "../../middlewares/checkAuth.js";
import { Role } from "./auth.model.js";


const router = Router();

router.post("/register", AuthControllers.createUser);
router.get('/me', checkAuth('owner', 'super_admin'), AuthControllers.getMe)
router.delete('/delete-me', checkAuth(Role.OWNER, Role.TENANT, Role.ADMIN), AuthControllers.deleteMe)
router.post("/login", AuthControllers.credentialsLogin);
router.post("/logout", AuthControllers.logout);

router.post("/change-password", AuthControllers.changePassword);

router.post("/forgot-password", AuthControllers.forgotPassword);
router.post("/reset-password", checkAuth('owner', 'super_admin', Role.TENANT), AuthControllers.resetPassword);


export const AuthRoutes = router;