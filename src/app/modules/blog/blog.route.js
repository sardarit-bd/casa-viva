import express from 'express';
import { blogControllers } from './blog.controller.js';
import { Role } from '../auth/auth.model.js';
import { checkAuth } from '../../middlewares/checkAuth.js';
import Blog from './blog.model.js';
import mongoose from 'mongoose';

const router = express.Router();

// Public routes
router.post("/fetchByIds", async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: "Invalid IDs" });
    }
console.log("ids", ids)
    // Convert string IDs to ObjectId
    const objectIds = ids.map(id => new mongoose.Types.ObjectId(id));
console.log("objectId", objectIds)
    const blogs = await Blog.find({ _id: { $in: objectIds } });
    console.log("blogs", blogs)
    res.json(blogs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
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