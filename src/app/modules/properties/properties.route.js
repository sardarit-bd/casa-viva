import express from 'express';
import { propertiesControllers } from './properties.controller.js';
import { Role } from '../auth/auth.model.js';
import { checkAuth } from '../../middlewares/checkAuth.js';
import mongoose from 'mongoose';
import Property from './properties.model.js';
;

const router = express.Router();

// Public routes
router.post("/fetchByIds", async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: "Invalid IDs" });
    }
    // Convert string IDs to ObjectId
    const objectIds = ids.map(id => new mongoose.Types.ObjectId(id));
    const fav = await Property.find({ _id: { $in: objectIds } });
    res.json(fav);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
router.get(
  '/',
  propertiesControllers.getAllProperties
);

router.get('/:id', propertiesControllers.getProperty);



// Owner/Agent routes
router.post(
  '/',
  checkAuth(Role.OWNER, Role.SUPER_ADMIN),
  propertiesControllers.createProperty
);

router.get(
  '/owner/my-properties',
  checkAuth(Role.OWNER, Role.SUPER_ADMIN),
  propertiesControllers.getMyProperties
);

router.get('/owner/stats', checkAuth(Role.OWNER, Role.SUPER_ADMIN), propertiesControllers.getPropertyStats);

router.get(
  '/owner/trash',
  checkAuth(Role.OWNER, Role.SUPER_ADMIN),
  propertiesControllers.getTrashedProperties
);

// Property management routes
router.patch(
  '/:id',
  checkAuth(Role.SUPER_ADMIN, Role.OWNER),
  propertiesControllers.updateProperty
);

router.patch(
  '/:id/featured', //will be called after payment
  propertiesControllers.toggleFeatured
);

router.patch(
  '/:id/status',
  checkAuth(Role.SUPER_ADMIN, Role.OWNER),
  propertiesControllers.updateStatus
);

router.patch('/:id/restore', checkAuth(Role.SUPER_ADMIN, Role.OWNER), propertiesControllers.restoreProperty);

router.delete('/:id', checkAuth(Role.SUPER_ADMIN, Role.OWNER),  propertiesControllers.deleteProperty);


router.delete('/admin/:id/permanent', checkAuth(Role.ADMIN, Role.SUPER_ADMIN), propertiesControllers.deleteProperty);

export const PropertiesRoutes = router;