import express from 'express';
import { blogControllers } from './blog.controller.js';
import { Role } from '../auth/auth.model.js';
import { checkAuth } from '../../middlewares/checkAuth.js';

const router = express.Router();

// Public routes
router.get(
  '/',
  blogControllers.getAllBlogs
);

router.get('/:id', blogControllers.getBlog);

// Author routes
router.post(
  '/',
  checkAuth(Role.OWNER, Role.SUPER_ADMIN, Role.ADMIN),
  blogControllers.createBlog
);

router.get(
  '/author/my-blogs',
  checkAuth(Role.OWNER, Role.SUPER_ADMIN),
  blogControllers.getMyBlogs
);

router.get(
  '/author/stats', 
  checkAuth(Role.OWNER, Role.SUPER_ADMIN), 
  blogControllers.getBlogStats
);

router.get(
  '/author/trash',
  checkAuth(Role.OWNER, Role.SUPER_ADMIN),
  blogControllers.getTrashedBlogs
);

// Blog management routes
router.patch(
  '/:id',
  checkAuth(Role.SUPER_ADMIN, Role.OWNER),
  blogControllers.updateBlog
);

router.patch(
  '/:id/status',
  checkAuth(Role.SUPER_ADMIN, Role.OWNER),
  blogControllers.updateStatus
);

router.patch(
  '/:id/restore', 
  checkAuth(Role.SUPER_ADMIN, Role.OWNER), 
  blogControllers.restoreBlog
);

router.delete(
  '/:id', 
  checkAuth(Role.SUPER_ADMIN, Role.OWNER),  
  blogControllers.deleteBlog
);

router.delete(
  '/admin/:id/permanent', 
  checkAuth(Role.ADMIN, Role.SUPER_ADMIN), 
  blogControllers.deleteBlog
);

export const BlogRoutes = router;