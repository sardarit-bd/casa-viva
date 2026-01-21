import httpStatus from 'http-status-codes';
import { catchAsync } from '../../utils/catchAsync.js';
import { blogServices } from './blog.service.js';
import { pick } from '../../utils/pick.js';

const createBlog = catchAsync(async (req, res) => {
  const blogData = {
    ...req.body,
  };

  const blog = await blogServices.createBlog(
    blogData, 
    req.user.userId
  );

  res.status(httpStatus.CREATED).json({
    success: true,
    message: 'Blog post created successfully',
    data: blog
  });
});

const getAllBlogs = catchAsync(async (req, res) => {
  const filter = pick(req.query, [
    'search', 'category', 'status', 'author'
  ]);
  
  const paginationOptions = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder']);
  
  const result = await blogServices.getAllBlogs(filter, paginationOptions);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Blog posts retrieved successfully',
    data: result.blogs,
    meta: result.meta
  });
});

const getBlog = catchAsync(async (req, res) => {
  const blog = await blogServices.getBlogById(req.params.id);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Blog post retrieved successfully',
    data: blog
  });
});

const updateBlog = catchAsync(async (req, res) => {
  const updateData = {
    ...req.body,
  };

  const blog = await blogServices.updateBlog(
    req.params.id, 
    updateData, 
    req.user.userId
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Blog post updated successfully',
    data: blog
  });
});

const deleteBlog = catchAsync(async (req, res) => {
  const permanent = req.query.permanent === 'true';
  
  const blog = await blogServices.deleteBlog(
    req.params.id, 
    req.user.userId,
    permanent
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: permanent ? 'Blog post permanently deleted' : 'Blog post moved to trash',
    data: null
  });
});

const getMyBlogs = catchAsync(async (req, res) => {
  const filter = pick(req.query, [
    'search', 'category', 'status'
  ]);
  
  const paginationOptions = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder']);
  
  const result = await blogServices.getMyBlogs(
    req.user.userId, 
    filter, 
    paginationOptions
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Your blog posts retrieved successfully',
    data: result.blogs,
    meta: result.meta
  });
});

const updateStatus = catchAsync(async (req, res) => {
  const { status } = req.body;
  
  const blog = await blogServices.updateStatus(
    req.params.id,
    req.user.userId,
    status
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: `Blog post status updated to ${status}`,
    data: blog
  });
});

const getBlogStats = catchAsync(async (req, res) => {
  const stats = await blogServices.getBlogStats(req.user.userId);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Blog statistics retrieved successfully',
    data: stats
  });
});

const restoreBlog = catchAsync(async (req, res) => {
  const blog = await blogServices.updateBlog(
    req.params.id,
    { 
      isDeleted: false, 
      deletedAt: null, 
      status: 'draft' 
    },
    req.user.userId
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Blog post restored successfully',
    data: blog
  });
});

const getTrashedBlogs = catchAsync(async (req, res) => {
  const filter = pick(req.query, [
    'search', 'category'
  ]);
  
  const paginationOptions = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder']);
  
  // Override filter to only show deleted blogs
  filter.isDeleted = true;
  filter.author = req.user.userId;
  
  const result = await blogServices.getAllBlogs(filter, paginationOptions);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Trashed blog posts retrieved successfully',
    data: result.blogs,
    meta: result.meta
  });
});

export const blogControllers = {
  createBlog,
  getAllBlogs,
  getBlog,
  updateBlog,
  deleteBlog,
  getMyBlogs,
  updateStatus,
  getBlogStats,
  restoreBlog,
  getTrashedBlogs
};