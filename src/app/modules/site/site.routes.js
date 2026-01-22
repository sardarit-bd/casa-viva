import express from 'express';
import { Role } from '../auth/auth.model.js';
import { checkAuth } from '../../middlewares/checkAuth.js';
import { siteServices } from './site.services.js';
import { siteControllers } from './site.controller.js';

const router = express.Router();

router.get(
  '/',
  siteControllers.getMySite
);

router.patch(
  '/',
  checkAuth(Role.SUPER_ADMIN, Role.ADMIN),
  siteControllers.updateSite
);




export const SiteRoutes = router;