import express from 'express';
import { propertiesControllers } from './properties.controller.js';
import upload from '../../middlewares/upload.js';
import { Role } from '../auth/auth.model.js';
import { checkAuth } from '../../middlewares/checkAuth.js';
;

const router = express.Router();

// Public routes
router.get(
  '/',
  propertiesControllers.getAllProperties
);

router.get('/:id', propertiesControllers.getProperty);

// Protected routes (Require authentication)
router.use(checkAuth(Role.OWNER, Role.AGENT, Role.ADMIN, Role.SUPER_ADMIN));

// Owner/Agent routes
router.post(
  '/',
  upload.handleMultipleImageUpload('images', 10),
  upload.validateImageDimensions(400, 300),
  upload.optimizeImages({ width: 1200, height: 800, quality: 80 }),
  propertiesControllers.createProperty
);

router.get(
  '/owner/my-properties',
  propertiesControllers.getMyProperties
);

router.get('/owner/stats', propertiesControllers.getPropertyStats);

router.get(
  '/owner/trash',
  propertiesControllers.getTrashedProperties
);

// Property management routes
router.patch(
  '/:id',
  upload.handleMultipleImageUpload('images', 10),
  upload.validateImageDimensions(400, 300),
  upload.optimizeImages({ width: 1200, height: 800, quality: 80 }),
  propertiesControllers.updateProperty
);

router.patch(
  '/:id/featured',
  propertiesControllers.toggleFeatured
);

router.patch(
  '/:id/status',
  propertiesControllers.updateStatus
);

router.patch('/:id/restore', propertiesControllers.restoreProperty);

router.delete('/:id', propertiesControllers.deleteProperty);

// Admin/Super Admin routes
router.use(checkAuth(Role.ADMIN, Role.SUPER_ADMIN));

router.get(
  '/admin/all',
  propertiesControllers.getAllProperties
);

router.delete('/admin/:id/permanent', propertiesControllers.deleteProperty);

export const PropertiesRoutes = router;